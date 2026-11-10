import { geoCentroid } from 'd3-geo'
import { useCallback, useEffect, useRef, useState } from 'react'
import Globe, { type GlobeMethods } from 'react-globe.gl'
import { useElementSize } from '../hooks/useElementSize'
import type { GlobeColors } from '../lib/modes'
import type { CountryFeature } from '../types'

const TEXTURES = `${import.meta.env.BASE_URL}textures`

// Accessors must keep a stable identity (module-level or memoised): a new
// function makes the globe re-process every polygon.
const label = (obj: object) => `<div class="globe-label">${(obj as CountryFeature).properties.name}</div>`

/** Rendering above 2x device pixels costs a lot of GPU time for little visible gain. */
const MAX_PIXEL_RATIO = 2

interface Props {
  countries: CountryFeature[]
  /** Country codes that have data in the current section. */
  available: Set<string>
  colors: GlobeColors
  selected: CountryFeature | null
  onSelect: (country: CountryFeature) => void
  /** Called once the globe and its texture are on screen. */
  onReady?: () => void
}

export function GlobeView({ countries, available, colors, selected, onSelect, onReady }: Props) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined)
  const [hovered, setHovered] = useState<CountryFeature | null>(null)
  const [containerRef, { width, height }] = useElementSize<HTMLDivElement>()
  // The globe mounts only once the container has been measured.
  const mounted = width > 0

  // Spin slowly while idle; stop once a country is selected.
  useEffect(() => {
    const controls = globeRef.current?.controls()
    if (!controls) return
    controls.autoRotate = selected === null
    controls.autoRotateSpeed = 0.4
  }, [selected, mounted])

  // Turn the camera to face the selected country.
  useEffect(() => {
    if (!selected) return
    const [lng, lat] = geoCentroid(selected)
    globeRef.current?.pointOfView({ lat, lng, altitude: 1.8 }, 1000)
  }, [selected])

  const capColor = useCallback(
    (obj: object) => {
      const f = obj as CountryFeature
      if (f === selected) return colors.selected
      if (f === hovered) return colors.hover
      return f.properties.code && available.has(f.properties.code) ? colors.available : colors.default
    },
    [selected, hovered, available, colors],
  )
  const sideColor = useCallback(() => colors.side, [colors])
  const strokeColor = useCallback(() => colors.stroke, [colors])

  const altitude = useCallback(
    (obj: object) => (obj === selected ? 0.04 : obj === hovered ? 0.02 : 0.01),
    [selected, hovered],
  )

  const handleReady = useCallback(() => {
    globeRef.current?.renderer().setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
    onReady?.()
  }, [onReady])

  const handleHover = useCallback((obj: object | null) => setHovered(obj as CountryFeature | null), [])
  const handleClick = useCallback((obj: object) => onSelect(obj as CountryFeature), [onSelect])

  return (
    <div ref={containerRef} className="globe">
      {mounted && (
        <Globe
          ref={globeRef}
          width={width}
          height={height}
          globeImageUrl={`${TEXTURES}/earth-dark.jpg`}
          backgroundImageUrl={`${TEXTURES}/night-sky.png`}
          onGlobeReady={handleReady}
          polygonsData={countries}
          polygonCapColor={capColor}
          polygonSideColor={sideColor}
          polygonStrokeColor={strokeColor}
          polygonAltitude={altitude}
          polygonLabel={label}
          polygonsTransitionDuration={200}
          onPolygonHover={handleHover}
          onPolygonClick={handleClick}
        />
      )}
    </div>
  )
}
