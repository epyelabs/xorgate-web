import { useEffect, useRef, useState } from "react"
import Map, { Layer, Marker, Source, type MapRef } from "react-map-gl/mapbox"
import "mapbox-gl/dist/mapbox-gl.css"

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

// Theme-matched Mapbox basemaps: follow the app's resolved light/dark theme.
const DARK_STYLE = "mapbox://styles/mapbox/dark-v11"
const LIGHT_STYLE = "mapbox://styles/mapbox/light-v11"

// Camera: start fully zoomed out (earth view), then fly in to street level on
// the first GPS fix and hold that zoom while following.
const EARTH_ZOOM = 1.5
const FOLLOW_ZOOM = 16

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
  following,
  onInteract,
}: {
  position: [number, number] | null
  track: [number, number][]
  // Follow state is owned by the parent so the Recenter control can live in the
  // telemetry strip; `onInteract` fires on a user pan/zoom to pause following.
  following: boolean
  onInteract: () => void
}) {
  const mapRef = useRef<MapRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const didZoomInRef = useRef(false)
  const [mapLoaded, setMapLoaded] = useState(false)
  const isDark = useIsDark()

  const lon = position?.[0]
  const lat = position?.[1]

  // Follow the device. On the FIRST fix, fly from the earth view down to the
  // device at FOLLOW_ZOOM; on later fixes (and on Recenter) ease to the new fix,
  // holding the follow zoom. Keyed on the lon/lat values (not the array identity)
  // so it fires only when the coordinates change, and waits for the map to load
  // so the first move animates rather than jumping. Manual pan/zoom clears
  // `following` (see onMoveStart); Recenter sets it back true → this re-runs.
  useEffect(() => {
    if (!mapLoaded || !following || lon === undefined || lat === undefined)
      return
    const map = mapRef.current
    if (!map) return
    if (didZoomInRef.current) {
      map.easeTo({ center: [lon, lat], zoom: FOLLOW_ZOOM, duration: 600 })
    } else {
      didZoomInRef.current = true
      map.flyTo({ center: [lon, lat], zoom: FOLLOW_ZOOM, duration: 2000 })
    }
  }, [mapLoaded, following, lon, lat])

  // mapbox-gl only auto-resizes on window resize, not when its container changes
  // width — e.g. the app sidebar collapsing (a CSS width transition, which fires
  // no window resize). Observe the container and resize the canvas so it always
  // fills the available space instead of leaving a white gap on the side.
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => mapRef.current?.resize())
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted p-6 text-center text-sm text-muted-foreground">
        Map view needs a Mapbox token. Set VITE_MAPBOX_TOKEN in your
        environment.
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
    <div ref={containerRef} className="h-full w-full">
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle={isDark ? DARK_STYLE : LIGHT_STYLE}
        initialViewState={{
          longitude: lon ?? 0,
          latitude: lat ?? 20,
          zoom: EARTH_ZOOM,
        }}
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
        onLoad={() => setMapLoaded(true)}
        onMoveStart={(e) => {
          // Only user gestures carry originalEvent; our own easeTo moves don't,
          // so this pauses auto-follow on pan/zoom but not on programmatic pans.
          if ("originalEvent" in e && e.originalEvent) onInteract()
        }}
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
          <Marker
            longitude={position[0]}
            latitude={position[1]}
            anchor="center"
          >
            <span className="relative flex h-3.5 w-3.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-60" />
              <span className="relative inline-flex h-3.5 w-3.5 rounded-full border-2 border-white bg-blue-500 shadow" />
            </span>
          </Marker>
        ) : null}
      </Map>
    </div>
  )
}
