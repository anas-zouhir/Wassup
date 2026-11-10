// Fetches every outlet's RSS feed from sources.json and writes the static
// JSON files the app reads (public/data). Run with `npm run fetch-news`.
//
// Options:
//   --check            only fetch and report; don't write anything
//   --sources <file>   use another sources file (e.g. to test new outlets)

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import Parser from 'rss-parser'
import type { CountryNews, Headline, NewsIndex, Outlet, OutletFeed } from '../src/types.ts'
import { limiter } from './limiter.ts'

interface Source extends Outlet {
  feed: string
}

interface MediaElement {
  $?: { url?: string; medium?: string; type?: string; width?: string }
}

interface FeedItem {
  mediaContent?: MediaElement[]
  mediaThumbnail?: MediaElement[]
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'public', 'data')
const MAX_ITEMS = 10
const MAX_SUMMARY = 220
// Items older than this are dropped; a feed with nothing newer is treated as dead.
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000
const TIMEOUT_MS = 15_000
// Some networks (VPNs, firewalls, antivirus filters) choke on many parallel
// connections, so keep this modest.
const CONCURRENCY = 6
const RETRY_DELAY_MS = 2000
/** Below this share of working feeds, assume the network is down and write nothing. */
const MIN_SUCCESS_RATIO = 0.5
/** A failed outlet keeps its previous headlines for this long. */
const MAX_FALLBACK_AGE_MS = 2 * 24 * 60 * 60 * 1000
const USER_AGENT = 'Mozilla/5.0 (compatible; WassupBot/0.1; news headlines reader)'

const parser = new Parser<object, FeedItem>({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
    ],
  },
})

/** Fetch with one retry on connection-level failures (timeouts, resets), which are often transient. */
async function request(url: string): Promise<Response> {
  const attempt = () =>
    fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  try {
    return await attempt()
  } catch {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    return attempt()
  }
}

async function fetchFeed(url: string) {
  const res = await request(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  // Not every feed is UTF-8 (fetch's .text() would assume it is): honour the
  // XML declaration, then the Content-Type header.
  const bytes = new Uint8Array(await res.arrayBuffer())
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200))
  const charset =
    /encoding=["']([\w-]+)["']/i.exec(head)?.[1] ??
    /charset=([\w-]+)/i.exec(res.headers.get('content-type') ?? '')?.[1] ??
    'utf-8'
  let xml: string
  try {
    xml = new TextDecoder(charset).decode(bytes)
  } catch {
    xml = new TextDecoder().decode(bytes)
  }
  return parser.parseString(xml)
}

type Item = Parser.Item & FeedItem

function pickImage(item: Item): string | undefined {
  const media = [...(item.mediaContent ?? []), ...(item.mediaThumbnail ?? [])]
    .map((m) => m.$)
    .filter((a) => a?.url && (!a.medium || a.medium === 'image') && (!a.type || a.type.startsWith('image/')))
    .sort((a, b) => Number(a?.width ?? 0) - Number(b?.width ?? 0))
  // Smallest image that is still big enough for a thumbnail.
  const fromMedia = media.find((a) => Number(a?.width ?? 0) >= 300) ?? media.at(-1)
  if (fromMedia?.url) return fromMedia.url

  if (item.enclosure?.url && (item.enclosure.type ?? 'image/').startsWith('image/')) return item.enclosure.url

  // Fall back to the first real <img> in the item's HTML, skipping tracking pixels.
  for (const [tag, src] of (item.content ?? '').matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    if (/\b(width|height)=["']?1["'\s/>]/i.test(tag) || /imrworldwide|pixel|tracking/i.test(src)) continue
    return decodeEntities(src)
  }
  return undefined
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Some feeds double-escape their text, leaving e.g. "&amp;" after XML parsing. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] !== '#') return NAMED_ENTITIES[code.toLowerCase()] ?? match
    const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match
  })
}

/** Plain, single-line text: strips tags and entities, collapses whitespace. */
function clean(text: string | undefined): string {
  return decodeEntities((text ?? '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

function summarize(item: Item): string | undefined {
  const text = clean(item.contentSnippet ?? item.summary)
  if (!text || text === clean(item.title)) return undefined
  if (text.length <= MAX_SUMMARY) return text
  return text.slice(0, text.lastIndexOf(' ', MAX_SUMMARY)) + '…'
}

function toHeadline(item: Item): Headline | null {
  const title = clean(item.title)
  const link = item.link?.trim()
  if (!title || !link) return null
  return {
    title,
    link,
    summary: summarize(item),
    image: pickImage(item),
    publishedAt: item.isoDate,
  }
}

async function fetchOutlet({ feed, ...outlet }: Source): Promise<OutletFeed> {
  const parsed = await fetchFeed(feed)
  // Keep the feed's own order: for front-page feeds it is the editors' ranking.
  const all = parsed.items.map(toHeadline).filter((h) => h !== null)
  if (all.length === 0) throw new Error('feed has no items')
  const cutoff = Date.now() - MAX_AGE_MS
  const items = all
    .filter((h) => !h.publishedAt || new Date(h.publishedAt).getTime() >= cutoff)
    .slice(0, MAX_ITEMS)
  if (items.length === 0) throw new Error('feed is stale (no items from the last 3 days)')
  return { outlet, fetchedAt: new Date().toISOString(), items }
}

async function main() {
  const { values: args } = parseArgs({
    options: { check: { type: 'boolean', default: false }, sources: { type: 'string' } },
  })
  const sourcesPath = args.sources ? resolve(args.sources) : join(ROOT, 'scripts', 'sources.json')
  const sources: Record<string, Source[]> = JSON.parse(readFileSync(sourcesPath, 'utf8'))
  const limit = limiter(CONCURRENCY)

  const newsDir = join(OUT_DIR, 'news')
  let fresh = 0
  let kept = 0

  const results = await Promise.all(
    Object.entries(sources).map(async ([country, outlets]) => {
      const settled = await Promise.allSettled(outlets.map((s) => limit(() => fetchOutlet(s))))
      const previous = readPrevious(newsDir, country)
      const feeds: OutletFeed[] = []
      settled.forEach((r, i) => {
        const id = outlets[i].id
        if (r.status === 'fulfilled') {
          carryOverTranslations(r.value, previous?.outlets.find((f) => f.outlet.id === id))
          feeds.push(r.value)
          fresh++
          console.log(`  ✓ ${country} ${id} (${r.value.items.length})`)
          return
        }
        const reason = r.reason instanceof Error ? (r.reason.cause ?? r.reason).toString() : String(r.reason)
        // A one-off failure shouldn't make an outlet vanish: keep its last
        // headlines while they're recent enough.
        const old = previous?.outlets.find((f) => f.outlet.id === id)
        if (old && Date.now() - Date.parse(old.fetchedAt) < MAX_FALLBACK_AGE_MS) {
          feeds.push(old)
          kept++
          console.warn(`  ~ ${country} ${id}: ${reason} (kept headlines from ${old.fetchedAt})`)
        } else {
          console.warn(`  ✗ ${country} ${id}: ${reason}`)
        }
      })
      return { country, outlets: feeds } satisfies CountryNews
    }),
  )

  const withNews = results.filter((r) => r.outlets.length > 0)
  const attempted = Object.values(sources).flat().length

  if (args.check) {
    console.log(`\n${fresh}/${attempted} feeds OK (check only, nothing written).`)
    return
  }
  if (fresh < attempted * MIN_SUCCESS_RATIO) {
    // Most feeds failing at once means the network is down, not the feeds.
    console.error(
      `\nOnly ${fresh}/${attempted} feeds could be fetched; probably a network problem. Leaving public/data untouched.`,
    )
    process.exit(1)
  }

  mkdirSync(newsDir, { recursive: true })
  for (const news of withNews) {
    writeFileSync(join(newsDir, `${news.country}.json`), JSON.stringify(news, null, 2) + '\n')
  }
  // Remove countries that have no news any more (dropped from sources, or every feed dead).
  const current = new Set(withNews.map((r) => `${r.country}.json`))
  for (const file of readdirSync(newsDir)) {
    if (!current.has(file)) rmSync(join(newsDir, file))
  }
  const index: NewsIndex = {
    updatedAt: new Date().toISOString(),
    countries: withNews.map((r) => r.country).sort(),
  }
  writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n')

  console.log(
    `\n${fresh}/${attempted} feeds fetched${kept ? `, ${kept} kept from the previous run` : ''}; ${withNews.length} countries written.`,
  )
}

/**
 * Copies English translations (added by translate-news.py) from the previous
 * run onto headlines whose text hasn't changed, so only new text is translated.
 */
function carryOverTranslations(feed: OutletFeed, previous: OutletFeed | undefined) {
  if (!previous) return
  const english = new Map<string, string>()
  for (const item of previous.items) {
    if (item.titleEn) english.set(item.title, item.titleEn)
    if (item.summary && item.summaryEn) english.set(item.summary, item.summaryEn)
  }
  for (const item of feed.items) {
    item.titleEn = english.get(item.title)
    if (item.summary) item.summaryEn = english.get(item.summary)
  }
}

function readPrevious(newsDir: string, country: string): CountryNews | null {
  try {
    return JSON.parse(readFileSync(join(newsDir, `${country}.json`), 'utf8')) as CountryNews
  } catch {
    return null
  }
}

await main()
