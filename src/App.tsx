import { useCallback, useEffect, useMemo, useState } from 'react'
import { FoodPanel } from './components/FoodPanel'
import { GlobeView } from './components/GlobeView'
import { LoadingScreen } from './components/LoadingScreen'
import { Logo } from './components/Logo'
import { NewsPanel } from './components/NewsPanel'
import { useMode } from './hooks/useMode'
import { loadCountries } from './lib/countries'
import { fetchFoodIndex, fetchNewsIndex } from './lib/data'
import { MODES, type Mode } from './lib/modes'
import type { CountryFeature } from './types'

const INDEX_FETCHERS: Record<Mode, () => Promise<{ countries: string[] }>> = {
  news: fetchNewsIndex,
  food: fetchFoodIndex,
}

function App() {
  const [mode, setMode] = useMode()
  const [countries, setCountries] = useState<CountryFeature[]>([])
  // Tagged with its mode so the globe never shows one section's availability in the other.
  const [available, setAvailable] = useState<{ mode: Mode; codes: string[] } | null>(null)
  const [selected, setSelected] = useState<CountryFeature | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [globeReady, setGlobeReady] = useState(false)

  useEffect(() => {
    loadCountries().then(setCountries, (e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    let cancelled = false
    // A missing index just means no country is marked as having data.
    INDEX_FETCHERS[mode]().then(
      (index) => !cancelled && setAvailable({ mode, codes: index.countries }),
      () => !cancelled && setAvailable({ mode, codes: [] }),
    )
    return () => {
      cancelled = true
    }
  }, [mode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleGlobeReady = useCallback(() => setGlobeReady(true), [])
  const codes = available?.mode === mode ? available.codes : null
  const availableSet = useMemo(() => new Set(codes ?? []), [codes])
  const loaded = globeReady && (countries.length > 0 || error !== null)
  const code = selected?.properties.code
  const hasData = !!code && availableSet.has(code)
  const closePanel = () => setSelected(null)

  return (
    <main className="app">
      <GlobeView
        countries={countries}
        available={availableSet}
        colors={MODES[mode].globe}
        selected={selected}
        onSelect={setSelected}
        onReady={handleGlobeReady}
      />

      <Logo mode={mode} onSwitch={setMode} ready={loaded} />
      {error && <p className="toast">{error}</p>}

      {/* Wait for the index so the panel doesn't flash "no data" while it loads. */}
      {selected && codes !== null && (
        mode === 'news' ? (
          <NewsPanel key={`news-${code ?? selected.properties.name}`} country={selected} hasNews={hasData} onClose={closePanel} />
        ) : (
          <FoodPanel key={`food-${code ?? selected.properties.name}`} country={selected} hasFood={hasData} onClose={closePanel} />
        )
      )}

      <LoadingScreen done={loaded} text={MODES[mode].loadingText} />
    </main>
  )
}

export default App
