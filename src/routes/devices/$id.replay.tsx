import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { ArrowLeftIcon } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ApiError,
  getDevice,
  getDeviceModel,
  getReplayManifest,
  type ActiveStreamsViewType,
  type ImuView,
  type IoCapabilities,
  type ReplayManifest,
  type ReplayManifestParams,
  type ReplaySegment,
} from "@/lib/api"
import {
  getDeviceModelResponseSchema,
  getDeviceResponseSchema,
  getReplayManifestResponseSchema,
} from "@/lib/schemas"
import { formatDateTime } from "@/lib/format-time"
import { formatDuration } from "@/components/data-table"
import { cn } from "@/lib/utils"
import { StreamsView } from "@/components/streams-view/streams-view"
import { ReplayVideoTile } from "@/components/replay/replay-video-tile"
import { ReplayTimelineBar } from "@/components/replay/replay-timeline"
import {
  buildClockTimeline,
  buildLanes,
  segmentUrlKey,
  type LaneSegment,
} from "@/lib/replay/lanes"
import { useReplayClock } from "@/hooks/use-replay-clock"
import { useReplayTelemetry } from "@/hooks/use-replay-telemetry"

interface ReplaySearch {
  session?: string
  from?: string
  to?: string
  streamKey?: string
}

// Minimum breathing room between manifest refetches when segment fetches hit
// 403 (expired URLs): one refetch fixes every tile, so a burst of tile errors
// must not turn into a burst of manifest calls.
const AUTH_REFRESH_MIN_INTERVAL_MS = 30_000

export const Route = createFileRoute("/devices/$id/replay")({
  validateSearch: (search: Record<string, unknown>): ReplaySearch => ({
    session: typeof search.session === "string" ? search.session : undefined,
    from: typeof search.from === "string" ? search.from : undefined,
    to: typeof search.to === "string" ? search.to : undefined,
    streamKey:
      typeof search.streamKey === "string" ? search.streamKey : undefined,
  }),
  beforeLoad: requireAuth,
  component: DeviceReplayPage,
})

// Replay page (composite replays plan, Phases 3–5): the same StreamsView the
// live tab renders, fed from the replay clock instead of the live feed. Two
// addressing modes, one page (R3/R5/R9):
//   ?session=<id>                 one recorded session (child-row entry)
//   ?from&to[&streamKey]          composite — every camera with coverage in
//                                 the range appears as its own lane on the
//                                 shared clock (run-row entry)
// The timeline/transport bar is page chrome (R8); the video slot holds one
// MSE tile per lane with clock-elected pacing (lib/replay/lanes.ts).
function DeviceReplayPage() {
  const { id } = Route.useParams()
  const {
    session: sessionId,
    from: fromParam,
    to: toParam,
    streamKey: streamKeyParam,
  } = Route.useSearch()

  const [caps, setCaps] = useState<IoCapabilities | null>(null)
  const [imuView, setImuView] = useState<ImuView | null>(null)
  const [viewType, setViewType] = useState<ActiveStreamsViewType>("card")
  const [following, setFollowing] = useState(true)

  // The FIRST manifest defines the replay (timeline + clock stay stable for
  // the whole visit); refetches — scheduled at urlExpiresAt or forced by a
  // 403 — only swap presigned URLs via urlMapRef.
  const [manifest, setManifest] = useState<ReplayManifest | null>(null)
  const [manifestError, setManifestError] = useState<string | null>(null)
  const urlMapRef = useRef(new Map<string, string>())

  // One params object per distinct replay target; keyed by its serialized
  // form so effects don't re-run on referential churn.
  const params = useMemo<ReplayManifestParams | null>(() => {
    if (sessionId) return { sessionId }
    if (fromParam && toParam) {
      return streamKeyParam
        ? { from: fromParam, to: toParam, streamKey: streamKeyParam }
        : { from: fromParam, to: toParam }
    }
    return null
  }, [sessionId, fromParam, toParam, streamKeyParam])

  // Device + model: seeds the view variant (persisted per-device setting) and
  // the capability-driven readout layout, same as the live streams page.
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
        setViewType(parsedDevice.data.device.activeStreamsViewType)
        setImuView(parsedDevice.data.device.imuView)
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
        if (!cancelled) toast.error(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  // Initial manifest fetch. Warm manifests take ~1.5–3 s on dev (cold ~6 s)
  // — the loading state below is not decorative.
  useEffect(() => {
    if (!params) return
    let cancelled = false
    // Reset-on-param-change: a new target must not replay stale state.
    /* eslint-disable react-hooks/set-state-in-effect */
    setManifest(null)
    setManifestError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    urlMapRef.current = new Map()
    ;(async () => {
      try {
        const raw = await getReplayManifest(id, params)
        const parsed = getReplayManifestResponseSchema.safeParse(raw)
        if (!parsed.success) throw new Error("Unexpected replay-manifest response")
        if (cancelled) return
        setManifest(parsed.data.replay)
      } catch (err) {
        const message =
          err instanceof ApiError && err.status === 404
            ? "Session not found (it may have been deleted)."
            : (err as Error).message
        if (!cancelled) setManifestError(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, params])

  // Manifest URL refresh: scheduled before urlExpiresAt (presigned URLs die
  // after ~1 h; the server already subtracted a 5 min margin), or forced
  // early when a tile reports a 403. Either way the timeline/clock are
  // untouched — only the seq→URL maps swap; in-buffer media keeps playing.
  const authRefreshRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (!manifest || !params) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let inFlight = false
    let lastAt = 0

    const schedule = (expiresAt: number) => {
      if (cancelled) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(
        () => void refresh(),
        Math.max(expiresAt - Date.now(), 30_000)
      )
    }
    const refresh = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      lastAt = Date.now()
      try {
        const raw = await getReplayManifest(id, params)
        const parsed = getReplayManifestResponseSchema.safeParse(raw)
        if (!parsed.success) throw new Error("bad refresh response")
        if (cancelled) return
        for (const s of parsed.data.replay.sessions) {
          for (const seg of s.segments) {
            urlMapRef.current.set(segmentUrlKey(s.id, seg.seq), seg.url)
          }
        }
        schedule(parsed.data.replay.urlExpiresAt)
      } catch {
        // Transient failure: retry in a minute; segment fetches keep using
        // the previous URLs (their backoff re-attempts) meanwhile.
        if (!cancelled) schedule(Date.now() + 60_000)
      } finally {
        inFlight = false
      }
    }

    authRefreshRef.current = () => {
      if (inFlight || Date.now() - lastAt < AUTH_REFRESH_MIN_INTERVAL_MS) return
      void refresh()
    }
    schedule(manifest.urlExpiresAt)
    return () => {
      cancelled = true
      authRefreshRef.current = () => {}
      if (timer) clearTimeout(timer)
    }
  }, [manifest, id, params])

  const lanes = useMemo(() => (manifest ? buildLanes(manifest) : []), [manifest])
  const timeline = useMemo(
    () =>
      manifest ? buildClockTimeline(lanes, manifest.from, manifest.to) : null,
    [manifest, lanes]
  )
  const clock = useReplayClock(timeline)
  const telemetry = useReplayTelemetry(id, timeline, clock, caps)

  const getSegmentUrl = useCallback((seg: ReplaySegment) => {
    const lane = seg as LaneSegment
    return (
      urlMapRef.current.get(segmentUrlKey(lane.sessionId, seg.seq)) ?? seg.url
    )
  }, [])
  const onTileAuthError = useCallback(() => authRefreshRef.current(), [])

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

  if (manifestError) {
    return <p className="text-sm text-destructive">{manifestError}</p>
  }

  if (!manifest || !timeline || !clock) {
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
      clock={clock}
      timeline={lane.timeline}
      label={lane.streamKey}
      getSegmentUrl={getSegmentUrl}
      onAuthError={onTileAuthError}
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
          Recorded telemetry failed to load ({telemetry.error}) — video still
          plays; reload the page to retry.
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

      <ReplayTimelineBar clock={clock} timeline={timeline} />
    </div>
  )
}
