import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import {
  getDeviceRecordings,
  getKvsChannels,
  startAllRecordings,
  startRecording,
  stopRecording,
  stopRecordingBeacon,
  type KvsChannel,
  type Recording,
} from "@/lib/api"
import {
  getDeviceRecordingsResponseSchema,
  getKvsChannelsResponseSchema,
} from "@/lib/schemas"
import { getIdToken } from "@/lib/cognito"
import { useKvsViewer, type KvsStatus } from "@/hooks/use-kvs-viewer"

// Live-status dot shown top-left of each tile, in place of a text badge. Green =
// connected, amber (pulsing) = transient states (connecting / reconnecting), light
// gray = waiting for the device, red = error. The label rides along as a tooltip +
// aria-label so the meaning stays accessible without taking up space.
const STATUS_META: Record<
  KvsStatus,
  { label: string; dot: string; pulse: boolean }
> = {
  connecting: { label: "Connecting", dot: "bg-amber-400", pulse: true },
  waiting: { label: "Waiting for device", dot: "bg-zinc-300", pulse: false },
  connected: { label: "Live", dot: "bg-green-500", pulse: false },
  closed: { label: "Reconnecting", dot: "bg-amber-400", pulse: true },
  error: { label: "Error", dot: "bg-red-500", pulse: false },
}

const POLL_MS = 5000
// A recording can sit in 'recording' with no frames for the recorder's ~30-60s cold
// start. If captureStartedAt is still null past this, the task is up but no frames are
// arriving — almost always the device master is down.
const WAITING_FOR_DEVICE_MS = 90_000

// Overlay shown while a cloud recorder is attached to this stream. The recorder reports
// a real "capturing" signal on its first received frame (captureStartedAt), so we can
// tell apart: the row exists but the task is still cold-starting ("Starting…"), the
// recorder has confirmed frames ("REC"), or the task is up but no frames are arriving
// ("Waiting for device"). This is driven by the backend signal, not a timer.
function CaptureIndicator({ recording }: { recording: Recording }) {
  const capturing = recording.captureStartedAt !== null
  const stalled =
    !capturing &&
    Date.now() - Date.parse(recording.startedAt) >= WAITING_FOR_DEVICE_MS

  const { dot, label } = capturing
    ? {
        dot: "bg-red-500 animate-pulse",
        label: `REC${recording.trigger === "auto" ? " · Auto" : ""}`,
      }
    : stalled
      ? { dot: "bg-muted-foreground", label: "Waiting for device" }
      : { dot: "bg-amber-400 animate-pulse", label: "Starting…" }

  return (
    <div className="flex items-center gap-1 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {label}
    </div>
  )
}

function LiveVideoTile({
  channel,
  label,
  recording,
  busy,
  onToggle,
}: {
  channel: KvsChannel
  label: string
  recording: Recording | undefined
  busy: boolean
  onToggle: () => void
}) {
  const { videoRef, status, error } = useKvsViewer(channel)
  const meta = STATUS_META[status]
  const isRecording = recording !== undefined

  return (
    <Card className="overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="relative aspect-video max-h-[40vh] w-full bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
          />
          <div className="absolute top-2 left-2 flex items-center gap-2">
            <span
              role="status"
              aria-label={meta.label}
              title={meta.label}
              className={cn(
                "inline-block size-2 rounded-full shadow-[0_0_2px_rgba(0,0,0,0.6)] ring-1 ring-white/70",
                meta.dot,
                meta.pulse && "animate-pulse"
              )}
            />
            {recording ? <CaptureIndicator recording={recording} /> : null}
          </div>
          <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
            {label}
          </div>
          <div className="absolute right-2 bottom-2">
            <Button
              size="sm"
              variant={isRecording ? "destructive" : "secondary"}
              disabled={busy}
              onClick={onToggle}
            >
              {busy ? "…" : isRecording ? "Stop" : "Record"}
            </Button>
          </div>
        </div>
        {status === "error" && error ? (
          <p className="p-2 text-xs text-destructive">{error}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/**
 * Live video grid: fetches the device's KVS channels and renders one VIEWER tile
 * per channel. Recording controls (per-source + "Record all") drive a cloud
 * viewer-recorder; the device's master stream + this browser's live view are
 * unaffected. Active recordings are polled so the REC indicator stays current
 * (including auto-records the backend started on its own).
 */
export function LiveVideoGrid({
  deviceId,
  videoCaps,
  title,
  showRecordAll = true,
}: {
  deviceId: string
  videoCaps: { key: string; label?: string }[]
  title?: string
  // When false, hides the bulk "Record all" control (per-tile Record stays).
  // Used by the Map View overlay, which omits the bulk action to save space.
  showRecordAll?: boolean
}) {
  const [channels, setChannels] = useState<KvsChannel[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeByStream, setActiveByStream] = useState<Map<string, Recording>>(
    new Map()
  )
  const [busyStreams, setBusyStreams] = useState<Set<string>>(new Set())
  const [allBusy, setAllBusy] = useState(false)

  // IDs of MANUAL recordings this tab started, for the pagehide courtesy stop below.
  // Scoped to this tab (never auto rows, never rows started elsewhere) per the locked
  // "keep recording server-side" decision.
  const manualStartedIdsRef = useRef<Set<string>>(new Set())
  // A synchronously-readable id token snapshot for the pagehide beacon, which cannot
  // await getIdToken(). Refreshed on mount + periodically; the token is valid ~1h so a
  // slightly stale copy is fine for a best-effort courtesy stop.
  const authTokenRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const token = await getIdToken()
        if (!cancelled) authTokenRef.current = token
      } catch {
        // ignore; the beacon simply won't fire without a token
      }
    }
    void refresh()
    const t = setInterval(() => void refresh(), 60_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  // Courtesy stop on tab close (manual recordings started in THIS tab only). Best-
  // effort: the server-side max-duration cap (backend Phase 2) is the real backstop.
  useEffect(() => {
    const onPagehide = () => {
      const token = authTokenRef.current
      if (!token) return
      for (const id of manualStartedIdsRef.current) {
        stopRecordingBeacon(deviceId, id, token)
      }
    }
    window.addEventListener("pagehide", onPagehide)
    return () => window.removeEventListener("pagehide", onPagehide)
  }, [deviceId])

  useEffect(() => {
    let cancelled = false
    setChannels(null)
    setLoadError(null)
    ;(async () => {
      try {
        const raw = await getKvsChannels(deviceId)
        const parsed = getKvsChannelsResponseSchema.safeParse(raw)
        if (!parsed.success) throw new Error("Unexpected kvs-channels response")
        if (!cancelled) setChannels(parsed.data.channels)
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [deviceId])

  const refreshRecordings = useCallback(async () => {
    try {
      const raw = await getDeviceRecordings(deviceId)
      const parsed = getDeviceRecordingsResponseSchema.safeParse(raw)
      if (!parsed.success) return
      const map = new Map<string, Recording>()
      for (const r of parsed.data.recordings) {
        if (r.status === "recording") map.set(r.streamKey, r)
      }
      setActiveByStream(map)
    } catch {
      // Polling errors are non-fatal; keep the last known state.
    }
  }, [deviceId])

  useEffect(() => {
    void refreshRecordings()
    const t = setInterval(() => void refreshRecordings(), POLL_MS)
    return () => clearInterval(t)
  }, [refreshRecordings])

  const setBusy = (streamKey: string, busy: boolean) =>
    setBusyStreams((prev) => {
      const next = new Set(prev)
      if (busy) next.add(streamKey)
      else next.delete(streamKey)
      return next
    })

  const clearActive = (streamKey: string) =>
    setActiveByStream((prev) => {
      if (!prev.has(streamKey)) return prev
      const next = new Map(prev)
      next.delete(streamKey)
      return next
    })

  async function toggleStream(streamKey: string) {
    const active = activeByStream.get(streamKey)
    setBusy(streamKey, true)
    try {
      if (active) {
        await stopRecording(deviceId, active.id)
        manualStartedIdsRef.current.delete(active.id)
        clearActive(streamKey) // optimistic: backend marks it 'stopping' immediately
        toast.success("Recording stopped")
      } else {
        const { recording } = await startRecording(deviceId, streamKey)
        manualStartedIdsRef.current.add(recording.id)
        toast.success("Recording started")
      }
      await refreshRecordings()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(streamKey, false)
    }
  }

  const allRecording =
    channels !== null &&
    channels.length > 0 &&
    channels.every((c) => activeByStream.has(c.streamKey))

  async function toggleAll() {
    setAllBusy(true)
    try {
      if (allRecording) {
        await Promise.all(
          [...activeByStream.values()].map((r) => {
            manualStartedIdsRef.current.delete(r.id)
            return stopRecording(deviceId, r.id)
          })
        )
        setActiveByStream(new Map()) // optimistic clear
        toast.success("All recordings stopped")
      } else {
        const { recordings } = await startAllRecordings(deviceId)
        for (const r of recordings) manualStartedIdsRef.current.add(r.id)
        toast.success("Recording all streams")
      }
      await refreshRecordings()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setAllBusy(false)
    }
  }

  const labelFor = (streamKey: string) =>
    videoCaps.find((c) => c.key === streamKey)?.label ?? streamKey

  const canRecordAll = showRecordAll && channels !== null && channels.length > 0

  let body
  if (loadError) {
    body = <p className="text-sm text-destructive">{loadError}</p>
  } else if (channels === null) {
    body = (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Skeleton className="aspect-video max-h-[40vh] w-full" />
        <Skeleton className="aspect-video max-h-[40vh] w-full" />
      </div>
    )
  } else if (channels.length === 0) {
    body = (
      <p className="text-sm text-muted-foreground">
        No live video channels. Provision the device to enable streaming.
      </p>
    )
  } else {
    body = (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {channels.map((ch) => (
          <LiveVideoTile
            key={ch.channelArn}
            channel={ch}
            label={labelFor(ch.streamKey)}
            recording={activeByStream.get(ch.streamKey)}
            busy={busyStreams.has(ch.streamKey)}
            onToggle={() => void toggleStream(ch.streamKey)}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {title || canRecordAll ? (
        <div
          className={cn(
            "flex items-center gap-2",
            title ? "justify-between" : "justify-end"
          )}
        >
          {title ? (
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          ) : null}
          {canRecordAll ? (
            <Button
              size="sm"
              variant={allRecording ? "destructive" : "default"}
              disabled={allBusy}
              onClick={toggleAll}
            >
              {allBusy ? "…" : allRecording ? "Stop all" : "Record all"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {body}
    </div>
  )
}
