import { useEffect, useRef, useState } from "react"
import Map, {
  Layer,
  Marker,
  NavigationControl,
  Source,
  type MapRef,
} from "react-map-gl/maplibre"
import "maplibre-gl/dist/maplibre-gl.css"
import { BoxIcon, LocateFixedIcon, SquareIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
// The worker pin is a module side effect and must run before any map is
// constructed; see lib/maplibre.ts, which also owns the two basemap styles.
import { basemapStyle, firstSymbolLayerId } from "@/lib/maplibre"
import { useIsDark } from "@/hooks/use-is-dark"

// Camera: start fully zoomed out (earth view), then fly in to street level on
// the first GPS fix and hold that zoom while following.
const EARTH_ZOOM = 1.5
const FOLLOW_ZOOM = 16

// The basemap's own vector source and its building polygons, which carry
// `render_height` / `render_min_height` from the OpenMapTiles schema — that is
// what makes real extrusions possible without a second data source.
const TILE_SOURCE = "openmaptiles"
const BUILDING_LAYER = "building"
// Buildings only exist in the tiles from z12, and only read as buildings well
// past that — below this the extrusion is visual noise.
const BUILDING_MIN_ZOOM = 14
// How far the camera leans in 3D. Enough to give the buildings volume without
// burying the device marker behind them.
const PITCH_3D = 50

/**
 * Full-bleed live location map for the Active Streams "Map View". Renders the
 * device's current position as a pulsing marker over a theme-matched MapLibre
 * basemap, plus a trailing breadcrumb polyline of recent fixes. Recenters as
 * new fixes arrive. `position` and each `track` point are [lon, lat] pairs
 * (GeoJSON coordinate order); `position` is null until the first GPS fix.
 */
export interface ReplayTrace {
  // Full recorded route (dim underlay) and the already-played portion
  // (highlight), as polylines split at recording holes. [lon, lat] order.
  route: [number, number][][]
  traveled: [number, number][][]
}

export function LiveLocationMap({
  position,
  track,
  course,
  following,
  onInteract,
  onRecenter,
  replayTrace,
}: {
  position: [number, number] | null
  track: [number, number][]
  // Course over ground in degrees true (0-360, clockwise from north), or null
  // when unknown (stationary / no lock). Drives the marker direction cone.
  course: number | null
  // Follow state is owned by the parent so the Recenter control can live in the
  // telemetry strip; `onInteract` fires on a user pan/zoom to pause following.
  following: boolean
  onInteract: () => void
  // Resumes following. The button lives here, with the other camera controls,
  // rather than being positioned by the parent over the map.
  onRecenter: () => void
  // Replay mode (composite replays plan, Phase 4): render a recorded route
  // underlay + traveled highlight instead of the live breadcrumb `track`.
  replayTrace?: ReplayTrace
}) {
  const mapRef = useRef<MapRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const didZoomInRef = useRef(false)
  const [mapLoaded, setMapLoaded] = useState(false)
  // Where to insert the overlay lines so they sit under the basemap's labels.
  // Resolved from the LOADED style rather than hard-coded: the light and dark
  // basemaps do not share layer ids, and MapLibre refuses to add a layer whose
  // `beforeId` is missing. `undefined` draws on top, which is the right way to
  // fail here.
  const [labelLayerId, setLabelLayerId] = useState<string | undefined>(
    undefined
  )
  // Flat by default: this is a tracking view first, and a tilted camera makes
  // a moving marker harder to read. 3D is one click away for the operator who
  // wants the buildings around a stopped vehicle.
  const [threeD, setThreeD] = useState(false)
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

  // Tilt is animated rather than set on the view state so toggling reads as
  // the camera leaning in, not the map snapping to a different projection.
  // Skipped on mount, where the flat initial view is already correct and the
  // ease would only fight the first flyTo.
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    mapRef.current?.easeTo({ pitch: threeD ? PITCH_3D : 0, duration: 600 })
  }, [threeD])

  // The basemap style is swapped wholesale on a theme change, which discards
  // every layer id resolved from the previous one. `onLoad` below covers the
  // first style, which loads before this effect attaches.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    const sync = () => setLabelLayerId(firstSymbolLayerId(map))
    map.on("style.load", sync)
    return () => {
      map.off("style.load", sync)
    }
  }, [])

  // maplibre-gl only auto-resizes on window resize, not when its container changes
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

  const trackGeojson =
    !replayTrace && track.length >= 2
      ? {
          type: "Feature" as const,
          properties: {},
          geometry: { type: "LineString" as const, coordinates: track },
        }
      : null

  const multiLine = (lines: [number, number][][]) => ({
    type: "Feature" as const,
    properties: {},
    geometry: { type: "MultiLineString" as const, coordinates: lines },
  })

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <Map
        ref={mapRef}
        mapStyle={basemapStyle(isDark)}
        initialViewState={{
          longitude: lon ?? 0,
          latitude: lat ?? 20,
          zoom: EARTH_ZOOM,
        }}
        maxPitch={70}
        style={{ width: "100%", height: "100%" }}
        // OpenFreeMap serves OpenStreetMap data, whose licence requires the
        // credit stay on screen. Compact keeps it to an "i" until clicked.
        attributionControl={{ compact: true }}
        onLoad={(event) => {
          setLabelLayerId(firstSymbolLayerId(event.target))
          setMapLoaded(true)
        }}
        onMoveStart={(e) => {
          // Only user gestures carry originalEvent; our own easeTo moves don't,
          // so this pauses auto-follow on pan/zoom but not on programmatic pans.
          if ("originalEvent" in e && e.originalEvent) onInteract()
        }}
      >
        {/* Zoom and compass. The compass doubles as the way back to north-up
            (and, with `visualizePitch`, out of a tilted camera) after a
            rotate/pitch gesture. The Recenter control lives on the other side
            of the panel so it never lands under this stack. */}
        <NavigationControl position="top-right" visualizePitch />

        {replayTrace && replayTrace.route.length > 0 ? (
          <Source
            id="replay-route"
            type="geojson"
            data={multiLine(replayTrace.route)}
          >
            <Layer
              id="replay-route-line"
              type="line"
              beforeId={labelLayerId}
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "#3b82f6",
                "line-width": 3,
                "line-opacity": 0.25,
              }}
            />
          </Source>
        ) : null}

        {replayTrace && replayTrace.traveled.length > 0 ? (
          <Source
            id="replay-traveled"
            type="geojson"
            data={multiLine(replayTrace.traveled)}
          >
            <Layer
              id="replay-traveled-line"
              type="line"
              beforeId={labelLayerId}
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "#3b82f6",
                "line-width": 3,
                "line-opacity": 0.85,
              }}
            />
          </Source>
        ) : null}

        {trackGeojson ? (
          <Source id="gps-trail" type="geojson" data={trackGeojson}>
            <Layer
              id="gps-trail-line"
              type="line"
              beforeId={labelLayerId}
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "#3b82f6",
                "line-width": 3,
                "line-opacity": 0.85,
              }}
            />
          </Source>
        ) : null}

        {threeD ? (
          <Layer
            id="xg-3d-buildings"
            type="fill-extrusion"
            source={TILE_SOURCE}
            source-layer={BUILDING_LAYER}
            minzoom={BUILDING_MIN_ZOOM}
            beforeId={labelLayerId}
            // `hide_3d` marks building *parts* that would z-fight with the
            // parent volume if both were extruded.
            filter={["!=", ["get", "hide_3d"], true]}
            paint={{
              "fill-extrusion-color": isDark ? "#2b2f33" : "#d9dde1",
              "fill-extrusion-height": ["get", "render_height"],
              "fill-extrusion-base": ["get", "render_min_height"],
              // Fade in over the first zoom level so buildings grow out of the
              // basemap instead of popping in as a solid block.
              "fill-extrusion-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                BUILDING_MIN_ZOOM,
                0,
                BUILDING_MIN_ZOOM + 1,
                0.9,
              ],
            }}
          />
        ) : null}

        {position ? (
          <Marker
            longitude={position[0]}
            latitude={position[1]}
            anchor="center"
          >
            <span className="relative flex h-3.5 w-3.5">
              {course !== null ? (
                // Direction-of-travel cone, fading outward from the dot. The map
                // never rotates (bearing 0), so screen-up is north and rotating
                // by `course` degrees clockwise points it the right way. Sits
                // behind the pulse/dot (rendered first).
                <span
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                  style={{ transform: `rotate(${course}deg)` }}
                >
                  <svg
                    width={64}
                    height={64}
                    viewBox="-32 -32 64 64"
                    className="overflow-visible"
                    aria-hidden
                  >
                    <defs>
                      <radialGradient
                        id="course-cone"
                        gradientUnits="userSpaceOnUse"
                        cx={0}
                        cy={0}
                        r={30}
                      >
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.55} />
                        <stop offset="55%" stopColor="#3b82f6" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                      </radialGradient>
                    </defs>
                    <path
                      d="M0 0 L-15.9 -25.4 A30 30 0 0 1 15.9 -25.4 Z"
                      fill="url(#course-cone)"
                    />
                  </svg>
                </span>
              ) : null}
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-60" />
              <span className="relative inline-flex h-3.5 w-3.5 rounded-full border-2 border-white bg-blue-500 shadow" />
            </span>
          </Marker>
        ) : null}
      </Map>

      {/* Every camera control the app owns, in one top-left column: the
          basemap's zoom/compass stack holds the top-right, the GPS strip runs
          along the bottom edge (so the bottom-left corner is not actually
          free) and the attribution sits bottom-right. Recenter comes first
          because it appears and disappears with the follow state — a stable
          2D/3D button under it never moves. */}
      <div className="absolute top-3 left-3 z-10 flex flex-col items-start gap-1.5">
        {!following && position ? (
          <Button
            size="icon"
            variant="ghost"
            onClick={onRecenter}
            title="Recenter map on device"
            aria-label="Recenter map on device"
            className="size-8 rounded-full border bg-background/85 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-background hover:text-foreground"
          >
            <LocateFixedIcon className="size-4" />
          </Button>
        ) : null}

        <button
          type="button"
          onClick={() => setThreeD((current) => !current)}
          aria-pressed={threeD}
          title={
            threeD
              ? "Switch to flat view"
              : `Switch to 3D view (buildings appear from zoom ${BUILDING_MIN_ZOOM})`
          }
          className="flex cursor-pointer items-center gap-1.5 rounded-md border bg-background/90 px-2 py-1.5 text-xs font-medium shadow-sm backdrop-blur transition-colors hover:bg-accent"
        >
          {threeD ? (
            <BoxIcon className="size-3.5" />
          ) : (
            <SquareIcon className="size-3.5" />
          )}
          {threeD ? "3D" : "2D"}
        </button>
      </div>
    </div>
  )
}
