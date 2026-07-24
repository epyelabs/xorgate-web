import { useEffect, useMemo, useRef, useState } from "react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
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
import { useAuthStore } from "@/store/auth"
import { StreamsView } from "@/components/streams-view/streams-view"
import { ReplayVideoTile } from "@/components/replay/replay-video-tile"
import { ReplayTimelineBar } from "@/components/replay/replay-timeline"
import { buildTimeline } from "@/lib/replay/timeline"
import { useReplayClock } from "@/hooks/use-replay-clock"
import { useReplayTelemetry } from "@/hooks/use-replay-telemetry"

interface ReplaySearch {
  session?: string
}

export const Route = createFileRoute("/devices/$id/replay")({
  validateSearch: (search: Record<string, unknown>): ReplaySearch => ({
    session: typeof search.session === "string" ? search.session : undefined,
  }),
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DeviceReplayPage,
})

// Session replay page (composite replays plan, Phase 3+4): the same
// StreamsView the live tab renders, fed from the replay clock instead of the
// live feed — readouts/IMU/map resolve recorded telemetry at the playhead via
// useReplayTelemetry; the video slot holds the MSE tile; the
// timeline/transport bar is page chrome (R8).
// The per-session entry is interim by design — Phase 5 replaces it with
// run-grouped, time-anchored composite links (R9).
function DeviceReplayPage() {
  const { id } = Route.useParams()
  const { session: sessionId } = Route.useSearch()

  const [caps, setCaps] = useState<IoCapabilities | null>(null)
  const [imuView, setImuView] = useState<ImuView | null>(null)
  const [viewType, setViewType] = useState<ActiveStreamsViewType>("card")
  const [following, setFollowing] = useState(true)

  // The FIRST manifest defines the replay (timeline + clock stay stable for
  // the whole visit); TTL refetches only swap presigned URLs via urlMapRef.
  const [manifest, setManifest] = useState<ReplayManifest | null>(null)
  const [manifestError, setManifestError] = useState<string | null>(null)
  const urlMapRef = useRef(new Map<number, string>())

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
    if (!sessionId) return
    let cancelled = false
    // Reset-on-param-change: a new session id must not replay stale state.
    /* eslint-disable react-hooks/set-state-in-effect */
    setManifest(null)
    setManifestError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    urlMapRef.current = new Map()
    ;(async () => {
      try {
        const raw = await getReplayManifest(id, { sessionId })
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
  }, [id, sessionId])

  // Manifest TTL refresh: presigned URLs die after ~1 h; urlExpiresAt already
  // includes the server's 5 min safety margin. Refetch silently and swap URLs
  // — the timeline/clock are untouched, in-buffer media keeps playing.
  useEffect(() => {
    if (!manifest || !sessionId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = (expiresAt: number) => {
      timer = setTimeout(
        () => {
          void (async () => {
            try {
              const raw = await getReplayManifest(id, { sessionId })
              const parsed = getReplayManifestResponseSchema.safeParse(raw)
              if (!parsed.success) throw new Error("bad refresh response")
              if (cancelled) return
              for (const s of parsed.data.replay.sessions) {
                for (const seg of s.segments) {
                  urlMapRef.current.set(seg.seq, seg.url)
                }
              }
              schedule(parsed.data.replay.urlExpiresAt)
            } catch {
              // Transient failure: retry in a minute; segment fetches keep
              // using the previous URLs meanwhile.
              if (!cancelled) schedule(Date.now() + 60_000)
            }
          })()
        },
        Math.max(expiresAt - Date.now(), 30_000)
      )
    }
    schedule(manifest.urlExpiresAt)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [manifest, id, sessionId])

  // MVP: session mode returns exactly one session (R5).
  const session = manifest?.sessions[0] ?? null
  const timeline = useMemo(
    () =>
      manifest && session
        ? buildTimeline(session, manifest.from, manifest.to)
        : null,
    [manifest, session]
  )
  const clock = useReplayClock(timeline)
  const telemetry = useReplayTelemetry(id, timeline, clock, caps)

  if (!sessionId) {
    return (
      <p className="text-sm text-muted-foreground">
        No session selected. Pick a recording on the{" "}
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

  if (!manifest || !session || !timeline || !clock) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Preparing replay… (building the session timeline can take a few
          seconds)
        </p>
        <Skeleton className="aspect-video max-h-[40vh] w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  const videoExpired = session.segments.length === 0
  const hasPartial = session.segments.some((s) => !s.finalized)
  const unsynced = session.timeSource === "unsynced"

  const tile = (
    <ReplayVideoTile
      clock={clock}
      label={session.streamKey}
      getSegmentUrl={(seg: ReplaySegment) =>
        urlMapRef.current.get(seg.seq) ?? seg.url
      }
    />
  )
  // Card view mirrors the live page's "Media" section chrome; map view drops
  // straight into the side column like the live grid does.
  const videoSlot = videoExpired ? null : viewType === "map" ? (
    tile
  ) : (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold tracking-tight">Media</h2>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{tile}</div>
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
            Replay · <span className="font-mono">{session.streamKey}</span>
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
          {session.status === "open" ? (
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
          This session was recorded while the device clock was unsynchronized —
          wall-clock times may be wrong, and telemetry alignment cannot be
          trusted.
        </p>
      ) : null}
      {session.status === "open" ? (
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
                : "No GPS recorded in this session"
          }
        />
      </div>

      <ReplayTimelineBar clock={clock} timeline={timeline} />
    </div>
  )
}
