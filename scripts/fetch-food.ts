// Builds the food data from dishes.json: for each dish, a description and photo
// from Wikipedia and, where a Wikibooks Cookbook page is given, the recipe
// itself. Writes public/data/food. Run with `npm run fetch-food`.
//
// Options:
//   --check            only fetch and report; don't write anything
//   --sources <file>   use another dishes file (e.g. to test new dishes)

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import type { CountryFood, Dish, FoodIndex, Recipe } from '../src/types.ts'
import { limiter } from './limiter.ts'

interface DishSource {
  id: string
  name: string
  localName?: string
  /** English Wikipedia article title. Optional, but a dish needs this or a recipe. */
  wikipedia?: string
  /** Wikibooks page title, e.g. "Cookbook:Carbonara Pasta". */
  wikibooks?: string
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'public', 'data', 'food')
const USER_AGENT = 'WassupBot/0.1 (personal project; news & food globe)'
const MAX_DESCRIPTION = 320
const TIMEOUT_MS = 20_000

// Wikimedia rate-limits aggressively (HTTP 429), so pages are fetched in
// batches through the Action API, one request at a time per wiki.
const wikipediaLimit = limiter(2)
const wikibooksLimit = limiter(1)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getJson<T>(url: string, attempt = 1): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  const text = await res.text()
  if (res.ok) {
    try {
      return JSON.parse(text) as T
    } catch {
      // An HTML "too many requests" page: retry below.
    }
  }
  if (attempt >= 6) throw new Error(`HTTP ${res.status}`)
  const retryAfter = Number(res.headers.get('retry-after'))
  await sleep(retryAfter > 0 ? retryAfter * 1000 : 3000 * 2 ** (attempt - 1))
  return getJson<T>(url, attempt + 1)
}

interface QueryPage {
  title: string
  missing?: boolean
  extract?: string
  thumbnail?: { source: string }
  fullurl?: string
  pageprops?: { disambiguation?: string }
  revisions?: { slots: { main: { content: string } } }[]
}

interface QueryResult {
  query?: {
    normalized?: { from: string; to: string }[]
    redirects?: { from: string; to: string }[]
    pages?: QueryPage[]
  }
}

/**
 * Runs an Action API `query` for many titles in batches and returns each
 * requested title's page (following normalisation and redirects).
 */
async function queryPages(
  api: string,
  params: string,
  titles: string[],
  batchSize: number,
  limit: ReturnType<typeof limiter>,
): Promise<Map<string, QueryPage>> {
  const byTitle = new Map<string, QueryPage>()
  const unique = [...new Set(titles)]
  const batches: string[][] = []
  for (let i = 0; i < unique.length; i += batchSize) batches.push(unique.slice(i, i + batchSize))

  await Promise.all(
    batches.map((batch) =>
      limit(async () => {
        const url = `${api}?action=query&format=json&formatversion=2&redirects=1&${params}&titles=${encodeURIComponent(batch.join('|'))}`
        const { query } = await getJson<QueryResult>(url)
        const pages = new Map((query?.pages ?? []).map((p) => [p.title, p]))
        const follow = (title: string) => {
          let t = query?.normalized?.find((n) => n.from === title)?.to ?? title
          t = query?.redirects?.find((r) => r.from === t)?.to ?? t
          return t
        }
        for (const title of batch) {
          const page = pages.get(follow(title))
          if (page) byTitle.set(title, page)
        }
        await sleep(300)
      }),
    ),
  )
  return byTitle
}

// --- Wikipedia ---

function trimDescription(text: string | undefined): string | undefined {
  const description = text
    // Pronunciation asides like "(Spanish: [ɡaθˈpatʃo])" are noise in a card.
    ?.replace(/\s*\([^()]*\[[^\]]*\][^()]*\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;])/g, '$1')
    .trim()
  if (!description || description.length <= MAX_DESCRIPTION) return description || undefined
  const cut = description.lastIndexOf('. ', MAX_DESCRIPTION)
  return cut > 80 ? description.slice(0, cut + 1) : description.slice(0, MAX_DESCRIPTION) + '…'
}

/** Intro text, thumbnail and URL for each title (extracts are limited to 20 per request). */
function fetchSummaries(titles: string[]) {
  return queryPages(
    'https://en.wikipedia.org/w/api.php',
    'prop=extracts|pageimages|info|pageprops&exintro=1&explaintext=1&exsentences=3&exlimit=20&piprop=thumbnail&pithumbsize=480&inprop=url&ppprop=disambiguation',
    titles,
    20,
    wikipediaLimit,
  )
}

// --- Wikibooks ---

/** Wikitext to plain text: drops templates, refs, files and markup; keeps link labels. */
function cleanWikitext(text: string): string {
  let s = text
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  // Templates can nest; strip innermost first until none are left.
  for (let prev = ''; prev !== s; ) {
    prev = s
    s = s.replace(/\{\{[^{}]*\}\}/g, '')
  }
  return s
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[(?:Cookbook:)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/\[https?:\/\/\S+\]/g, '')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Lines of the section whose heading matches, including its sub-sections. */
function section(wikitext: string, heading: RegExp): string[] {
  const lines = wikitext.split('\n')
  const out: string[] = []
  let level = 0
  for (const line of lines) {
    const h = /^(={2,6})\s*(.*?)\s*\1\s*$/.exec(line)
    if (h) {
      if (level && h[1].length <= level) break
      if (!level && heading.test(h[2])) level = h[1].length
      continue
    }
    if (level) out.push(line)
  }
  return out
}

function listItems(lines: string[], marker: '*' | '#'): string[] {
  const re = marker === '*' ? /^\*+:?\s*(.+)/ : /^#+:?\s*(.+)/
  return lines
    .map((l) => re.exec(l)?.[1])
    .filter((l): l is string => !!l)
    .map(cleanWikitext)
    .filter((l) => l.length > 1)
}

/** Rows of a wikitable ("| a || b || c"), each row's non-empty cells joined. */
function tableRows(lines: string[]): string[] {
  return lines
    .filter((l) => /^\|(?![-}+])/.test(l))
    .map((l) =>
      l
        .slice(1)
        .split('||')
        .map(cleanWikitext)
        .filter((cell) => cell && cell !== '–' && cell !== '-')
        .join(', '),
    )
    .filter((row) => row.length > 1)
}

/** Plain paragraphs (for methods written as prose rather than a list). */
function paragraphs(lines: string[]): string[] {
  return lines
    .filter((l) => l.trim() && !/^[*#|{!:;]/.test(l))
    .map(cleanWikitext)
    .filter((p) => p.length > 20)
}

function parseRecipe(wikitext: string): Omit<Recipe, 'source'> | null {
  const ingredientLines = section(wikitext, /ingredient/i)
  let ingredients = listItems(ingredientLines, '*')
  if (ingredients.length === 0) ingredients = tableRows(ingredientLines)
  const method = section(wikitext, /procedure|method|preparation|directions|instructions|steps|cooking/i)
  let steps = listItems(method, '#')
  if (steps.length === 0) steps = listItems(method, '*')
  if (steps.length === 0) steps = paragraphs(method)
  if (ingredients.length < 2 || steps.length < 1) return null
  return { ingredients, steps }
}

/** Wikitext of each Wikibooks page (up to 50 per request). */
function fetchWikibooksPages(titles: string[]) {
  return queryPages(
    'https://en.wikibooks.org/w/api.php',
    'prop=revisions&rvprop=content&rvslots=main',
    titles,
    50,
    wikibooksLimit,
  )
}

const wikibooksUrl = (title: string) => `https://en.wikibooks.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`

// --- Main ---

function buildDish(
  source: DishSource,
  summaries: Map<string, QueryPage>,
  books: Map<string, QueryPage>,
): { dish: Dish; problems: string[] } {
  const problems: string[] = []
  const dish: Dish = {
    id: source.id,
    name: source.name,
    localName: source.localName && source.localName !== source.name ? source.localName : undefined,
    videoSearch: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${source.name} recipe`)}`,
  }

  if (source.wikipedia) {
    const page = summaries.get(source.wikipedia)
    if (!page || page.missing) problems.push(`wikipedia "${source.wikipedia}": not found`)
    else if (page.pageprops?.disambiguation !== undefined) problems.push(`wikipedia "${source.wikipedia}": is a disambiguation page`)
    else {
      dish.description = trimDescription(page.extract)
      dish.image = page.thumbnail?.source
      dish.wikipedia = page.fullurl
    }
  }

  if (source.wikibooks) {
    const page = books.get(source.wikibooks)
    const wikitext = page?.revisions?.[0]?.slots.main.content
    const recipe = wikitext ? parseRecipe(wikitext) : null
    if (!page || page.missing || !wikitext) problems.push(`wikibooks "${source.wikibooks}": not found`)
    else if (!recipe) problems.push(`wikibooks "${source.wikibooks}": no ingredients/steps found on the page`)
    else dish.recipe = { ...recipe, source: wikibooksUrl(page.title) }
  }

  // A bare name with only a video link isn't worth a card.
  if (!dish.wikipedia && !dish.recipe) problems.push('needs a Wikipedia article or a parsable Wikibooks recipe')

  return { dish, problems }
}

async function main() {
  const { values: args } = parseArgs({
    options: { check: { type: 'boolean', default: false }, sources: { type: 'string' } },
  })
  const sourcesPath = args.sources ? resolve(args.sources) : join(ROOT, 'scripts', 'dishes.json')
  const sources: Record<string, DishSource[]> = JSON.parse(readFileSync(sourcesPath, 'utf8'))

  const allSources = Object.values(sources).flat()
  const [summaries, books] = await Promise.all([
    fetchSummaries(allSources.flatMap((d) => (d.wikipedia ? [d.wikipedia] : []))),
    fetchWikibooksPages(allSources.flatMap((d) => (d.wikibooks ? [d.wikibooks] : []))),
  ])

  let problemCount = 0
  const results: CountryFood[] = Object.entries(sources).map(([country, dishes]) => {
    const built = dishes.map((d) => buildDish(d, summaries, books))
    for (const { dish, problems } of built) {
      const flags = [
        dish.description ? 'wiki' : '-',
        dish.image ? 'img' : '-',
        dish.recipe ? `recipe ${dish.recipe.ingredients.length}/${dish.recipe.steps.length}` : '-',
      ]
      if (problems.length) {
        problemCount += problems.length
        console.warn(`  ✗ ${country} ${dish.id} [${flags.join(' ')}]: ${problems.join('; ')}`)
      } else {
        console.log(`  ✓ ${country} ${dish.id} [${flags.join(' ')}]`)
      }
    }
    // Dishes with neither a Wikipedia article nor a recipe are reported above and left out.
    return { country, dishes: built.map((b) => b.dish).filter((d) => d.wikipedia || d.recipe) }
  })

  const all = results.flatMap((r) => r.dishes)
  const summary = `${all.length} dishes in ${results.length} countries: ${all.filter((d) => d.description).length} with description, ${all.filter((d) => d.image).length} with photo, ${all.filter((d) => d.recipe).length} with full recipe; ${problemCount} problems.`

  if (args.check) {
    console.log(`\n${summary} (check only, nothing written)`)
    return
  }

  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  const withDishes = results.filter((r) => r.dishes.length > 0)
  for (const food of withDishes) {
    writeFileSync(join(OUT_DIR, `${food.country}.json`), JSON.stringify(food, null, 2) + '\n')
  }
  const index: FoodIndex = {
    updatedAt: new Date().toISOString(),
    countries: withDishes.map((r) => r.country).sort(),
  }
  writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n')
  console.log(`\n${summary}`)
}

await main()
