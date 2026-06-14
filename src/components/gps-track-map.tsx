import { useEffect, useRef } from "react"
import Map, { Layer, Marker, Source, type MapRef } from "react-map-gl/maplibre"
import "maplibre-gl/dist/maplibre-gl.css"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// Dev-only demo tiles — swap for a styled basemap (via an env-configured style
// URL) before production.
const MAP_STYLE = "https://demotiles.maplibre.org/style.json"

function boundsOf(track: [number, number][]): [[number, number], [number, number]] {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const [lon, lat] of track) {
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ]
}

// Historical GPS path: polyline + start (green) / end (red) markers, auto-fit
// to the track. `track` is [lon, lat] pairs in chronological order (MapLibre
// coordinate order).
export function GpsTrackMap({ track }: { track: [number, number][] }) {
  const mapRef = useRef<MapRef>(null)

  useEffect(() => {
    if (track.length < 2) return
    mapRef.current?.fitBounds(boundsOf(track), { padding: 40, duration: 600 })
  }, [track])

  if (track.length < 2) return null

  const start = track[0]
  const end = track[track.length - 1]
  const geojson = {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: track },
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">GPS track</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-md border" style={{ height: 320 }}>
          <Map
            ref={mapRef}
            initialViewState={{ longitude: end[0], latitude: end[1], zoom: 12 }}
            mapStyle={MAP_STYLE}
            style={{ width: "100%", height: "100%" }}
          >
            <Source id="gps-track" type="geojson" data={geojson}>
              <Layer
                id="gps-track-line"
                type="line"
                paint={{ "line-color": "#2563eb", "line-width": 3 }}
              />
            </Source>
            <Marker longitude={start[0]} latitude={start[1]} color="#16a34a" />
            <Marker longitude={end[0]} latitude={end[1]} color="#dc2626" />
          </Map>
        </div>
        <div className="text-muted-foreground mt-2 text-xs tabular-nums">
          {track.length} points · start {start[1].toFixed(5)}, {start[0].toFixed(5)} · end{" "}
          {end[1].toFixed(5)}, {end[0].toFixed(5)}
        </div>
      </CardContent>
    </Card>
  )
}
