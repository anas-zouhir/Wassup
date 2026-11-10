import type { CountryFood, CountryNews, FoodIndex, NewsIndex } from '../types'

const DATA_URL = `${import.meta.env.BASE_URL}data`

const cache = new Map<string, Promise<unknown>>()

/** Fetches a file from public/data once per session. */
function loadJson<T>(path: string): Promise<T> {
  let request = cache.get(path) as Promise<T> | undefined
  if (!request) {
    request = fetch(`${DATA_URL}/${path}`).then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`)
      return res.json() as Promise<T>
    })
    // Don't cache failures, so reopening the country retries.
    request.catch(() => cache.delete(path))
    cache.set(path, request)
  }
  return request
}

export const fetchNewsIndex = () => loadJson<NewsIndex>('index.json')
export const fetchCountryNews = (code: string) => loadJson<CountryNews>(`news/${code}.json`)

export const fetchFoodIndex = () => loadJson<FoodIndex>('food/index.json')
export const fetchCountryFood = (code: string) => loadJson<CountryFood>(`food/${code}.json`)
