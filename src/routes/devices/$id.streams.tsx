import { useEffect, useState } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  ApiError,
  getDevice,
  getDeviceModel,
  type ActiveStreamsViewType,
  type IoCapabilities,
} from "@/lib/api"
import {
  getDeviceModelResponseSchema,
  getDeviceResponseSchema,
} from "@/lib/schemas"
import { useAuthStore } from "@/store/auth"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import {
  gpsMetrics,
  imuAccelMetrics,
  imuEulerMetrics,
  imuQuaternionMetrics,
  signalMetrics,
  systemMetrics,
} from "@/lib/capability-metrics"
import { useIotTelemetry } from "@/hooks/use-iot-telemetry"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  GroupedTelemetryReadout,
  TelemetryReadout,
} from "@/components/telemetry-readout"
import { LiveVideoGrid } from "@/components/live-video-grid"
import { LiveLocationMap } from "@/components/live-location-map"
import { TelemetryStrip } from "@/components/telemetry-strip"
import { Button } from "@/components/ui/button"
import { LocateFixedIcon } from "lucide-react"

export const Route = createFileRoute("/devices/$id/streams")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DeviceStreamsPage,
})

function DeviceStreamsPage() {
  const { id } = Route.useParams()
  const [caps, setCaps] = useState<IoCapabilities | null>(null)
  const [viewType, setViewType] = useState<ActiveStreamsViewType>("card")
  const [metaLoading, setMetaLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Map View camera follow: auto-centres on new fixes until the operator pans or
  // zooms, then pauses (Recenter resumes). Owned here so the Recenter control can
  // sit inline with the telemetry strip.
  const [following, setFollowing] = useState(true)
  const { latest, history, status, error: connError } = useIotTelemetry(id)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rawDevice = await getDevice(id)
        const parsedDevice = getDeviceResponseSchema.safeParse(rawDevice)
        if (!parsedDevice.success) {
          throw new Error("Unexpected /devices/:id response shape")
        }
        if (cancelled) return
        useBreadcrumbStore
          .getState()
          .setDeviceName(
            parsedDevice.data.device.name ?? parsedDevice.data.device.serial
          )
        setViewType(parsedDevice.data.device.activeStreamsViewType)

        const rawModel = await getDeviceModel(
          parsedDevice.data.device.deviceModelId
        )
        const parsedModel = getDeviceModelResponseSchema.safeParse(rawModel)
        if (parsedModel.success && !cancelled) {
          setCaps(parsedModel.data.device_model.ioCapabilities ?? null)
        }
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : (err as Error).message
        if (!cancelled) {
          setLoadError(message)
          toast.error(message)
        }
      } finally {
        if (!cancelled) setMetaLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const videoCaps = caps?.media?.video ?? []

  // Live position + trailing breadcrumb for the Map View, derived from the same
  // telemetry the card view reads. Coordinates are [lon, lat] (Mapbox order).
  const lat = latest["gps.lat"]?.value
  const lon = latest["gps.lon"]?.value
  const position: [number, number] | null =
    typeof lat === "number" && typeof lon === "number" ? [lon, lat] : null
  const track: [number, number][] = []
  for (const p of history) {
    const pLat = p["gps.lat"]
    const pLon = p["gps.lon"]
    if (typeof pLat === "number" && typeof pLon === "number") {
      track.push([pLon, pLat])
    }
  }

  const imuGroups = [
    { label: "Orientation", metrics: imuQuaternionMetrics(caps) },
    { label: "Euler", metrics: imuEulerMetrics(caps) },
    { label: "Acceleration", metrics: imuAccelMetrics(caps) },
  ].filter((g) => g.metrics.length > 0)
  const telemetryGroups = [
    { title: "System", metrics: systemMetrics(caps) },
    { title: "Signal", metrics: signalMetrics(caps) },
    { title: "GPS / Location", metrics: gpsMetrics(caps) },
  ].filter((g) => g.metrics.length > 0)
  const hasTelemetry = imuGroups.length > 0 || telemetryGroups.length > 0

  // Map View: a full-height location-first layout. The map fills the tab, the
  // telemetry rides as an icon strip up top, and the live media floats bottom-
  // right. `h-full` fills the tab's scroll wrapper so nothing overflows the page.
  if (viewType === "map") {
    return (
      <div className="relative h-full w-full overflow-hidden rounded-lg border">
        <LiveLocationMap
          position={position}
          track={track}
          following={following}
          onInteract={() => setFollowing(false)}
        />

        {!position ? (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 rounded-full bg-background/85 px-3 py-1 text-xs text-muted-foreground shadow backdrop-blur-sm">
            Waiting for GPS fix…
          </div>
        ) : null}

        {/* Telemetry strip centered up top; the Recenter control floats at the
            right so it never steals width from (or scrolls) the strip. */}
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
          <div className="pointer-events-auto max-w-full">
            <TelemetryStrip caps={caps} latest={latest} />
          </div>
        </div>

        {!following && position ? (
          <div className="pointer-events-auto absolute top-3 right-3">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setFollowing(true)}
              title="Recenter map on device"
              aria-label="Recenter map on device"
              className="size-8 rounded-full border bg-background/85 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-background hover:text-foreground"
            >
              <LocateFixedIcon className="size-4" />
            </Button>
          </div>
        ) : null}

        {videoCaps.length > 0 ? (
          <div className="absolute right-3 bottom-3 w-[36rem] max-w-[70%]">
            <LiveVideoGrid
              deviceId={id}
              videoCaps={videoCaps}
              showRecordAll={false}
            />
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {status === "error" && connError ? (
        <p className="text-sm text-destructive">{connError}</p>
      ) : null}
      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : null}

      {metaLoading ? (
        <StreamsSkeleton />
      ) : (
        <>
          {videoCaps.length > 0 ? (
            <section>
              <LiveVideoGrid
                deviceId={id}
                videoCaps={videoCaps}
                title="Media"
              />
            </section>
          ) : null}

          {hasTelemetry ? (
            <>
              <Separator />
              <section className="flex flex-col gap-3">
                <h2 className="text-base font-semibold tracking-tight">
                  Telemetry
                </h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                  {imuGroups.length > 0 ? (
                    <GroupedTelemetryReadout
                      title="IMU"
                      latest={latest}
                      groups={imuGroups}
                    />
                  ) : null}
                  {telemetryGroups.map((g) => (
                    <TelemetryReadout
                      key={g.title}
                      title={g.title}
                      latest={latest}
                      metrics={g.metrics}
                    />
                  ))}
                </div>
              </section>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}

// A single telemetry-card placeholder that mirrors TelemetryReadout's size="sm"
// card: a short title with a few key/value rows.
function TelemetryCardSkeleton() {
  return (
    <Card size="sm">
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-20" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-12" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// Loading placeholder for the whole page while the device + model capabilities
// are fetched. Mirrors the loaded layout (Media grid, then the Telemetry cards)
// so nothing shifts once the real content arrives.
function StreamsSkeleton() {
  return (
    <>
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Skeleton className="aspect-video max-h-[40vh] w-full" />
          <Skeleton className="aspect-video max-h-[40vh] w-full" />
        </div>
      </section>
      <Separator />
      <section className="flex flex-col gap-3">
        <Skeleton className="h-5 w-24" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <TelemetryCardSkeleton key={i} />
          ))}
        </div>
      </section>
    </>
  )
}
