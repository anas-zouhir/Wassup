# Wassup

Spin the globe, click a country, and see today's front-page headlines from its main news outlets.

## Stack

- **Vite + React + TypeScript**
- **react-globe.gl** (three.js) for the 3D globe
- **world-atlas** (Natural Earth 1:50m) + **topojson-client** for country shapes
- **i18n-iso-countries** to map ISO numeric ids to alpha-2 codes
- Static JSON in `public/data/`, hosted on GitHub Pages (no server)

## Getting started

```sh
npm install
npm run dev
```

Other scripts: `npm run build`, `npm run preview`, `npm run lint`, `npm run fetch-news`.

## Project layout

```
public/
  data/
    index.json        # { updatedAt, countries: ["FR", ...] } — countries with news
    news/<CODE>.json  # headlines per outlet for one country (see src/types.ts)
  textures/           # globe and sky images (from three-globe)
src/
  components/
    GlobeView.tsx     # the globe: hover/click/highlight, camera focus
    NewsPanel.tsx     # side panel: outlet picker + headlines
  hooks/              # useCountryNews, useWindowSize
  lib/
    countries.ts      # loads country shapes and attaches ISO codes
    news.ts           # fetches data/*.json (with in-memory cache)
  types.ts            # data shapes, shared with the fetch script
scripts/
  sources.json        # outlets per country (ISO alpha-2) with their RSS feed
  fetch-news.ts       # fetches feeds -> public/data
```

## Data

Headlines come from each outlet's own RSS feed (free, no API keys). Outlets are listed per
country in `scripts/sources.json`. To refresh the data:

```sh
npm run fetch-news
```

This fetches every feed and rewrites `public/data/` (see `scripts/fetch-news.ts`). Feeds that
fail or have nothing from the last 3 days are skipped and reported. Later, a scheduled GitHub
Actions job will run the same script.

To add an outlet, add an entry to `scripts/sources.json` and run the script. To test outlets
without touching the site's data, put them in a separate file and run
`npm run fetch-news -- --check --sources path/to/file.json`.

## Food

The *food* section (switch by clicking the italic word in the logo, or open `#food`)
shows each country's typical dishes. Dishes are curated per country in
`scripts/dishes.json`:

```json
{ "id": "carbonara", "name": "Carbonara", "localName": "Spaghetti alla carbonara",
  "wikipedia": "Carbonara", "wikibooks": "Cookbook:Carbonara Pasta" }
```

`npm run fetch-food` pulls each dish's description and photo from English Wikipedia and,
when a `wikibooks` page is given, the recipe (ingredients and steps) from the Wikibooks
Cookbook, then writes `public/data/food/`. Dishes without a recipe link to a YouTube recipe
search. Both sources are CC BY-SA and are credited in the panel. Recipes don't change, so
this only needs re-running when `dishes.json` changes. `--check` and `--sources` work as
for `fetch-news`.

## Deployment

`.github/workflows/deploy.yml` runs `npm run fetch-news`, commits the refreshed
`public/data` back to the repo, then builds the site and publishes it to GitHub Pages. A
second job then translates new non-English headlines to English (see below), commits them
and publishes again. It runs on every push to `main`, twice a day (06:00 and 18:00 UTC),
and by hand from the Actions tab ("Run workflow").

## Translation

The news panel shows one translation control, preferring the better one available:

- **Translate to <your language>** (desktop Chrome/Edge): the browser's built-in, on-device
  Translator API, into the reader's browser language. Used wherever it supports the
  outlet's language.
- **Show in English** (fallback: phones, other browsers, or languages the browser can't
  translate): pre-made translations. `scripts/translate-news.py`
  translates headlines and summaries with Meta's open NLLB-200 model (distilled 600M,
  int8, via CTranslate2) and stores them as `titleEn` / `summaryEn`. `fetch-news` carries
  translations over for unchanged headlines, so each run only translates new text. To run
  it locally: `pip install -r scripts/requirements.txt`, then
  `python scripts/translate-news.py` (add `--limit N` to try a few).

Neither is offered when the outlet is already in the reader's language. Pages must be set to **Settings → Pages → Source: GitHub
Actions**.

## Future improvements

- **Blocked feeds:** many outlets' feeds fail with HTTP 403/429 because the script identifies
  itself as a bot. Sending a normal browser User-Agent would probably bring back CBC, News24,
  Haaretz, WAFA and others, but it means disguising the script as a browser. To revisit.
