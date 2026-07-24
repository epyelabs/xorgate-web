import type { ReactNode } from "react"
import { LocateFixedIcon } from "lucide-react"
import type { ActiveStreamsViewType, ImuView, IoCapabilities } from "@/lib/api"
import type { LatestReading } from "@/hooks/use-iot-telemetry"
import {
  gpsMetrics,
  imuAccelMetrics,
  imuEulerMetrics,
  imuQuaternionMetrics,
  signalMetrics,
  systemMetrics,
} from "@/lib/capability-metrics"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  GroupedTelemetryReadout,
  TelemetryReadout,
} from "@/components/telemetry-readout"
import {
  LiveLocationMap,
  type ReplayTrace,
} from "@/components/live-location-map"
import { TelemetryPanel } from "@/components/telemetry-panel"
import { ImuPanel } from "@/components/imu-panel"
import { GpsStrip } from "@/components/gps-strip"
import { Button } from "@/components/ui/button"

export interface StreamsViewProps {
  viewType: ActiveStreamsViewType
  caps: IoCapabilities | null
  latest: Record<string, LatestReading>
  imuView: ImuView | null
  // Map data, [lon, lat] (Mapbox order). The producer decides what "track"
  // means: the live page feeds a trailing breadcrumb, replay a recorded trace.
  position: [number, number] | null
  track: [number, number][]
  course: number | null
  // Map camera follow: owned by the page so it can persist across view/layout
  // changes. The view reports interactions (false) and Recenter clicks (true).
  following: boolean
  onFollowingChange: (following: boolean) => void
  // Status chrome above the telemetry column/sections (e.g. the live page's
  // recording indicator). Rendered as-is; pass null to omit.
  indicatorSlot?: ReactNode
  // Video tiles for this page's medium (live KVS grid / replay MSE tiles).
  // The section wrapper only renders when non-null, mirroring the live page's
  // videoCaps.length gate.
  videoSlot?: ReactNode
  // Replay-only: recorded route underlay + traveled highlight for the map
  // (live pages omit it and keep the breadcrumb `track`).
  replayTrace?: ReplayTrace
  // Copy for the map's no-position overlay; the live default reads as
  // "waiting", replay passes recording-truth wording instead.
  gpsEmptyLabel?: string
}

/**
 * Shared live/replay layout for a device's streams (decision R8): the exact
 * Card and Map view variants the Active Streams tab renders, as a pure
 * prop-driven component. Pages own the data plumbing — live feeds it from
 * useIotTelemetry + the KVS grid, replay from the replay clock + MSE tiles —
 * and any future view variant added here works for both automatically.
 */
export function StreamsView({
  viewType,
  caps,
  latest,
  imuView,
  position,
  track,
  course,
  following,
  onFollowingChange,
  indicatorSlot,
  videoSlot,
  replayTrace,
  gpsEmptyLabel = "Waiting for GPS fix…",
}: StreamsViewProps) {
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

  // Map View: a split location-first layout. The map holds the left half; the
  // right half stacks the telemetry sections, the live 3D orientation of the
  // device, and the media tiles. `h-full` + `min-h-0` fill the tab's scroll
  // wrapper and let the right column scroll on its own rather than pushing the
  // page. Below `lg` the two halves stack instead of splitting.
  if (viewType === "map") {
    return (
      <div className="flex h-full min-h-0 w-full flex-col gap-3 lg:flex-row">
        <div className="relative min-h-64 flex-1 overflow-hidden rounded-lg border">
          <LiveLocationMap
            position={position}
            track={track}
            course={course}
            following={following}
            onInteract={() => onFollowingChange(false)}
            replayTrace={replayTrace}
          />

          {!position ? (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-background/85 px-3 py-1 text-xs text-muted-foreground shadow backdrop-blur-sm">
              {gpsEmptyLabel}
            </div>
          ) : null}

          {!following && position ? (
            <div className="absolute top-3 right-3">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onFollowingChange(true)}
                title="Recenter map on device"
                aria-label="Recenter map on device"
                className="size-8 rounded-full border bg-background/85 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-background hover:text-foreground"
              >
                <LocateFixedIcon className="size-4" />
              </Button>
            </div>
          ) : null}

          {/* GPS rides over the map rather than in the side column: it describes
              the position the map is already showing. Bottom-centred clears the
              Mapbox wordmark in the corner. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
            <div className="pointer-events-auto max-w-full">
              <GpsStrip caps={caps} latest={latest} />
            </div>
          </div>
        </div>

        {/* The system/signal card and the media hold their natural height; the
            IMU card takes whatever is left (its 3D box absorbing the slack), so
            the column fills the tab instead of trailing off into empty space. It
            only scrolls if that leftover runs out. */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {indicatorSlot}

          <TelemetryPanel caps={caps} latest={latest} />

          <ImuPanel caps={caps} latest={latest} view={imuView} />

          {videoSlot != null ? (
            <div className="shrink-0">{videoSlot}</div>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <>
      {indicatorSlot}

      {videoSlot != null ? <section>{videoSlot}</section> : null}

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

// Loading placeholder for the card view while the device + model capabilities
// are fetched. Mirrors the loaded layout (Media grid, then the Telemetry cards)
// so nothing shifts once the real content arrives.
export function StreamsSkeleton() {
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
