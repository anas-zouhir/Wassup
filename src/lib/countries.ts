import { geoArea } from 'd3-geo'
import type { MultiPolygon, Polygon, Position } from 'geojson'
import countries from 'i18n-iso-countries'
import { feature } from 'topojson-client'
import { presimplify, simplify, sphericalTriangleArea } from 'topojson-simplify'
import type { GeometryCollection, Topology } from 'topojson-specification'
import countriesUrl from 'world-atlas/countries-50m.json?url'
import type { CountryFeature } from '../types'

// world-atlas has no ISO code for these, but they are commonly used.
const CODE_OVERRIDES: Record<string, string> = {
  Kosovo: 'XK',
}

// The globe draws every polygon as its own mesh, so the raw 1:50m data
// (~1,600 polygons, ~100k points) makes rendering and hover picking slow.
/** Minimum triangle area (steradians) a point must span to survive simplification (~15 km detail). */
const SIMPLIFY_MIN_WEIGHT = 1e-6
/** Islands smaller than this (steradians, ~800 km²) are dropped, except a country's largest piece. */
const MIN_ISLAND_AREA = 2e-5

type CountriesTopology = Topology<{ countries: GeometryCollection<{ name: string }> }>

/** Keeps a country's largest polygon plus any others above MIN_ISLAND_AREA. */
function dropSmallIslands(geometry: Polygon | MultiPolygon): Polygon | MultiPolygon {
  if (geometry.type === 'Polygon') return geometry
  const areas = geometry.coordinates.map((coordinates) => geoArea({ type: 'Polygon', coordinates }))
  const largest = Math.max(...areas)
  const kept: Position[][][] = geometry.coordinates.filter(
    (_, i) => areas[i] === largest || areas[i] >= MIN_ISLAND_AREA,
  )
  return kept.length === 1 ? { type: 'Polygon', coordinates: kept[0] } : { ...geometry, coordinates: kept }
}

/** Loads country shapes (Natural Earth 1:50m, simplified) with ISO alpha-2 codes attached. */
export async function loadCountries(): Promise<CountryFeature[]> {
  const res = await fetch(countriesUrl)
  if (!res.ok) throw new Error(`Failed to load country shapes (${res.status})`)
  const topology = simplify(
    presimplify((await res.json()) as CountriesTopology, sphericalTriangleArea),
    SIMPLIFY_MIN_WEIGHT,
  ) as CountriesTopology

  const collection = feature(topology, topology.objects.countries)
  return collection.features
    .filter((f) => f.properties.name !== 'Antarctica')
    .map((f) => ({
      ...f,
      geometry: dropSmallIslands(f.geometry as Polygon | MultiPolygon),
      properties: {
        name: f.properties.name,
        code:
          CODE_OVERRIDES[f.properties.name] ??
          (f.id !== undefined ? (countries.numericToAlpha2(String(f.id)) ?? null) : null),
      },
    })) as CountryFeature[]
}
