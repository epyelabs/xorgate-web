import { useMemo, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { requireWorkspace } from "@/lib/auth-guard"
import { ArrowLeftIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { MetricName } from "@xorgate/sdk"
import {
  useReplayManifest,
  useReplayPlayer,
  useReplayTelemetry,
  type UseReplayManifestParams,
} from "@xorgate/react"
import { xgMessage } from "@/lib/xorgate"
import { useDevice, useDeviceModel } from "@/queries/devices"
import {
  gpsMetrics,
  imuMetrics,
  signalMetrics,
  systemMetrics,
} from "@/lib/capability-metrics"
import { formatDateTime } from "@/lib/format-time"
import { formatDuration } from "@/components/data-table"
import { cn } from "@/lib/utils"
import { StreamsView } from "@/components/streams-view/streams-view"
import { ReplayVideoTile } from "@/components/replay/replay-video-tile"
import { ReplayTimelineBar } from "@/components/replay/replay-timeline"

interface ReplaySearch {
  session?: string
  from?: string
  to?: string
  streamKey?: string
}

export const Route = createFileRoute("/devices/$id/replay")({
  validateSearch: (search: Record<string, unknown>): ReplaySearch => ({
    session: typeof search.session === "string" ? search.session : undefined,
    from: typeof search.from === "string" ? search.from : undefined,
    to: typeof search.to === "string" ? search.to : undefined,
    streamKey:
      typeof search.streamKey === "string" ? search.streamKey : undefined,
  }),
  beforeLoad: requireWorkspace,
  component: DeviceReplayPage,
})

// Replay page (composite replays plan, Phases 3–5): the same StreamsView the
// live tab renders, fed from the replay clock instead of the live feed. Two
// addressing modes, one page (R3/R5/R9):
//   ?session=<id>                 one recorded session (child-row entry)
//   ?from&to[&streamKey]          composite — every camera with coverage in
//                                 the range appears as its own lane on the
//                                 shared clock (run-row entry)
// The whole replay engine — manifest fetch + URL refresh, timeline/lane math,
// the clock, per-lane MSE — lives in @xorgate/react now; this page is chrome
// plus the capability-driven readout layout.
function DeviceReplayPage() {
  const { id } = Route.useParams()
  const {
    session: sessionId,
    from: fromParam,
    to: toParam,
    streamKey: streamKeyParam,
  } = Route.useSearch()

  // Device + model: seeds the view variant (persisted per-device setting) and
  // the capability-driven readout layout, same query keys as the live streams
  // page, so entering a replay from the Media tab costs no extra request.
  const device = useDevice(id).data ?? null
  const caps = useDeviceModel(device?.deviceModelId).data?.ioCapabilities ?? null
  const imuView = device?.uiPrefs.imuView ?? null
  // Local (non-persisted) view toggle; until the operator touches it, the
  // view follows the device's saved Active Streams preference.
  const [viewOverride, setViewType] = useState<"card" | "map" | null>(null)
  const viewType =
    viewOverride ?? device?.uiPrefs.activeStreamsViewType ?? "card"
  const [following, setFollowing] = useState(true)

  // One params object per distinct replay target; keyed by its serialized
  // form so the manifest hook doesn't re-run on referential churn.
  const params = useMemo<UseReplayManifestParams | null>(() => {
    if (sessionId) return { sessionId }
    if (fromParam && toParam) {
      return streamKeyParam
        ? { from: fromParam, to: toParam, streamKey: streamKeyParam }
        : { from: fromParam, to: toParam }
    }
    return null
  }, [sessionId, fromParam, toParam, streamKeyParam])

  // Manifest (with its own presigned-URL refresh cycle) + the player. A
  // refetch that describes the same replay swaps only URLs; the timeline and
  // clock stay stable for the whole visit — the package owns that contract.
  const manifestQuery = useReplayManifest(id, params)
  const manifest = manifestQuery.data ?? null
  const player = useReplayPlayer(manifest)

  // Same capability-driven metric groups the live views read, passed
  // explicitly so the hook does not re-fetch device + model for discovery.
  const metrics = useMemo<MetricName[] | undefined>(() => {
    if (!caps) return undefined
    return [
      ...gpsMetrics(caps),
      ...imuMetrics(caps),
      ...signalMetrics(caps),
      ...systemMetrics(caps),
    ] as MetricName[]
  }, [caps])
  const telemetry = useReplayTelemetry(id, player, { metrics })

  const { timeline, lanes } = player

  if (!params) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing selected to replay. Pick a recording run on the{" "}
        <Link
          to="/devices/$id/media"
          params={{ id }}
          className="underline underline-offset-2"
        >
          Media Recordings
        </Link>{" "}
        tab and press Replay.
      </p>
    )
  }

  if (manifestQuery.error) {
    const message =
      manifestQuery.error.status === 404
        ? "Session not found (it may have been deleted)."
        : xgMessage(manifestQuery.error)
    return <p className="text-sm text-destructive">{message}</p>
  }

  if (!manifest || !timeline) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Preparing replay… (building the timeline can take a few seconds)
        </p>
        <Skeleton className="aspect-video max-h-[40vh] w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  const rangeMode = !sessionId
  // Session mode may return a session whose media all expired (R6) — the
  // telemetry-only replay. Range mode omits such sessions server-side.
  const videoExpired = !rangeMode && lanes.length === 0
  const noVideoInRange = rangeMode && lanes.length === 0
  const hasPartial = lanes.some((l) => l.hasPartial)
  const unsynced = manifest.sessions.some((s) => s.timeSource === "unsynced")
  const anyOpen = manifest.sessions.some((s) => s.status === "open")
  const title =
    lanes.length > 0
      ? lanes.map((l) => l.streamKey).join(" + ")
      : (manifest.sessions[0]?.streamKey ?? "no video")

  const tiles = lanes.map((lane) => (
    <ReplayVideoTile
      key={lane.streamKey}
      player={player}
      streamKey={lane.streamKey}
      label={lane.streamKey}
    />
  ))
  // Both views use the live grid's exact tile layout (side-by-side on lg —
  // in map view that keeps the whole side column on-screen like the Active
  // Streams tab); card view adds the "Media" section heading, map view drops
  // the bare grid into the side column like LiveVideoGrid does.
  const tileGrid = (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{tiles}</div>
  )
  const videoSlot =
    lanes.length === 0 ? null : viewType === "map" ? (
      tileGrid
    ) : (
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold tracking-tight">Media</h2>
        {tileGrid}
      </div>
    )

  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        viewType === "map" && "h-full min-h-0"
      )}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size="icon-sm" variant="ghost" asChild>
          <Link
            to="/devices/$id/media"
            params={{ id }}
            title="Back to recordings"
            aria-label="Back to recordings"
          >
            <ArrowLeftIcon className="size-4" />
          </Link>
        </Button>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h1 className="text-sm font-semibold tracking-tight">
            Replay · <span className="font-mono">{title}</span>
          </h1>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDateTime(timeline.from)} —{" "}
            {formatDateTime(timeline.to)} ·{" "}
            {formatDuration(timeline.to - timeline.from)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {unsynced ? (
            <Badge
              variant="outline"
              title="The device clock was not synchronized when this was recorded — times may be wrong."
            >
              clock unsynced
            </Badge>
          ) : null}
          {anyOpen ? (
            <Badge
              variant="secondary"
              title="Still uploading — this replay covers up to the last uploaded segment. Reload to extend."
            >
              <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
              Receiving
            </Badge>
          ) : null}
          {hasPartial ? (
            <Badge
              variant="outline"
              title="Includes segments cut mid-recording (power loss or crash) — marked on the timeline."
            >
              partial
            </Badge>
          ) : null}
        </div>
        {/* Local (non-persisted) view toggle; the initial value follows the
            device's saved Active Streams view. */}
        <div className="ml-auto flex items-center gap-1">
          {(["card", "map"] as const).map((v) => (
            <Button
              key={v}
              size="sm"
              variant={viewType === v ? "secondary" : "ghost"}
              onClick={() => setViewType(v)}
            >
              {v === "card" ? "Card" : "Map"}
            </Button>
          ))}
        </div>
      </header>

      {unsynced ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          This was recorded while the device clock was unsynchronized —
          wall-clock times may be wrong, and telemetry alignment cannot be
          trusted.
        </p>
      ) : null}
      {anyOpen ? (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Still uploading — this replay covers up to the last uploaded segment.
          Reload the page to extend it.
        </p>
      ) : null}
      {videoExpired ? (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          This session&apos;s video has expired — recordings are kept for 90
          days. Recorded telemetry is kept forever and still replays below.
        </p>
      ) : null}
      {noVideoInRange ? (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          No video recorded in this time range (or it has expired — recordings
          are kept for 90 days). Recorded telemetry still replays below.
        </p>
      ) : null}
      {telemetry.error ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Recorded telemetry failed to load ({xgMessage(telemetry.error)}) —
          video still plays; reload the page to retry.
        </p>
      ) : null}

      <div className={cn(viewType === "map" && "min-h-0 flex-1")}>
        <StreamsView
          viewType={viewType}
          caps={caps}
          latest={telemetry.latest}
          imuView={imuView}
          position={telemetry.position}
          track={[]}
          course={telemetry.course}
          following={following}
          onFollowingChange={setFollowing}
          videoSlot={videoSlot}
          replayTrace={{
            route: telemetry.routeLines,
            traveled: telemetry.traveledLines,
          }}
          gpsEmptyLabel={
            telemetry.loading
              ? "Loading recorded telemetry…"
              : telemetry.hasGps
                ? "No GPS at this point in the recording"
                : "No GPS recorded in this replay"
          }
        />
      </div>

      <ReplayTimelineBar player={player} timeline={timeline} />
    </div>
  )
}
