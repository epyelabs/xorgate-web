import { useEffect, useRef, useState } from "react"
import Map, {
  Layer,
  Marker,
  Source,
  type MapRef,
} from "react-map-gl/mapbox"
import "mapbox-gl/dist/mapbox-gl.css"

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

// Theme-matched Mapbox basemaps: follow the app's resolved light/dark theme.
const DARK_STYLE = "mapbox://styles/mapbox/dark-v11"
const LIGHT_STYLE = "mapbox://styles/mapbox/light-v11"

// Track whether the app is currently in dark mode by watching the `dark` class
// the ThemeProvider toggles on <html>. This reflects the resolved theme (so it
// reacts to both explicit toggles and system changes) without reaching into the
// provider internals — the same signal other components read for Monaco, etc.
function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false
  )
  useEffect(() => {
    const root = document.documentElement
    const update = () => setIsDark(root.classList.contains("dark"))
    update()
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  return isDark
}

/**
 * Full-bleed live location map for the Active Streams "Map View". Renders the
 * device's current position as a pulsing marker over a theme-matched Mapbox
 * basemap, plus a trailing breadcrumb polyline of recent fixes. Recenters as
 * new fixes arrive. `position` and each `track` point are [lon, lat] pairs
 * (Mapbox coordinate order); `position` is null until the first GPS fix.
 */
export function LiveLocationMap({
  position,
  track,
}: {
  position: [number, number] | null
  track: [number, number][]
}) {
  const mapRef = useRef<MapRef>(null)

  // Follow the device: ease the camera to each new fix. Kept as a light pan so
  // the operator stays oriented rather than being snapped around.
  useEffect(() => {
    if (!position) return
    mapRef.current?.easeTo({ center: position, duration: 600 })
  }, [position])

  const isDark = useIsDark()

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted p-6 text-center text-sm text-muted-foreground">
        Map view needs a Mapbox token. Set VITE_MAPBOX_TOKEN in your environment.
      </div>
    )
  }

  const trackGeojson =
    track.length >= 2
      ? {
          type: "Feature" as const,
          properties: {},
          geometry: { type: "LineString" as const, coordinates: track },
        }
      : null

  return (
    <Map
      ref={mapRef}
      mapboxAccessToken={MAPBOX_TOKEN}
      mapStyle={isDark ? DARK_STYLE : LIGHT_STYLE}
      initialViewState={{
        longitude: position?.[0] ?? 0,
        latitude: position?.[1] ?? 20,
        zoom: position ? 15 : 1.5,
      }}
      style={{ width: "100%", height: "100%" }}
      attributionControl={false}
    >
      {trackGeojson ? (
        <Source id="gps-trail" type="geojson" data={trackGeojson}>
          <Layer
            id="gps-trail-line"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": "#3b82f6",
              "line-width": 3,
              "line-opacity": 0.85,
            }}
          />
        </Source>
      ) : null}

      {position ? (
        <Marker longitude={position[0]} latitude={position[1]} anchor="center">
          <span className="relative flex h-3.5 w-3.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-60" />
            <span className="relative inline-flex h-3.5 w-3.5 rounded-full border-2 border-white bg-blue-500 shadow" />
          </span>
        </Marker>
      ) : null}
    </Map>
  )
}
