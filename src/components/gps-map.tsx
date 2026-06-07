import { useEffect, useRef } from "react"
import Map, { Marker, type MapRef } from "react-map-gl/maplibre"
import "maplibre-gl/dist/maplibre-gl.css"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// MapLibre demo tiles need no API token — fine for dev. Swap for a styled
// basemap (via an env-configured style URL) before production.
const MAP_STYLE = "https://demotiles.maplibre.org/style.json"

export function GpsMap({ lat, lon }: { lat: number; lon: number }) {
  const mapRef = useRef<MapRef>(null)

  useEffect(() => {
    mapRef.current?.easeTo({ center: [lon, lat], duration: 600 })
  }, [lat, lon])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">GPS</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-md border" style={{ height: 320 }}>
          <Map
            ref={mapRef}
            initialViewState={{ longitude: lon, latitude: lat, zoom: 12 }}
            mapStyle={MAP_STYLE}
            style={{ width: "100%", height: "100%" }}
          >
            <Marker longitude={lon} latitude={lat} color="#2563eb" />
          </Map>
        </div>
        <div className="text-muted-foreground mt-2 text-xs tabular-nums">
          {lat.toFixed(5)}, {lon.toFixed(5)}
        </div>
      </CardContent>
    </Card>
  )
}
