import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  getDeviceRecordings,
  getKvsChannels,
  startAllRecordings,
  startRecording,
  stopRecording,
  type KvsChannel,
  type Recording,
} from "@/lib/api"
import {
  getDeviceRecordingsResponseSchema,
  getKvsChannelsResponseSchema,
} from "@/lib/schemas"
import { useKvsViewer, type KvsStatus } from "@/hooks/use-kvs-viewer"

const STATUS_META: Record<
  KvsStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  connecting: { label: "Connecting", variant: "secondary" },
  waiting: { label: "Waiting for device", variant: "outline" },
  connected: { label: "Live", variant: "default" },
  closed: { label: "Reconnecting", variant: "outline" },
  error: { label: "Error", variant: "destructive" },
}

const POLL_MS = 5000

// Red "REC" overlay shown while a cloud recorder is capturing this stream.
function RecIndicator({ trigger }: { trigger: Recording["trigger"] }) {
  return (
    <div className="flex items-center gap-1 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
      REC{trigger === "auto" ? " · Auto" : ""}
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
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="relative aspect-video max-h-[40vh] w-full bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-contain"
          />
          <div className="absolute left-2 top-2 flex items-center gap-2">
            <Badge variant={meta.variant}>{meta.label}</Badge>
            {isRecording ? <RecIndicator trigger={recording.trigger} /> : null}
          </div>
          <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
            {label}
          </div>
          <div className="absolute bottom-2 right-2">
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
          <p className="text-destructive p-2 text-xs">{error}</p>
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
}: {
  deviceId: string
  videoCaps: { key: string; label?: string }[]
}) {
  const [channels, setChannels] = useState<KvsChannel[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeByStream, setActiveByStream] = useState<Map<string, Recording>>(
    new Map()
  )
  const [busyStreams, setBusyStreams] = useState<Set<string>>(new Set())
  const [allBusy, setAllBusy] = useState(false)

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

  async function toggleStream(streamKey: string) {
    const active = activeByStream.get(streamKey)
    setBusy(streamKey, true)
    try {
      if (active) {
        await stopRecording(deviceId, active.id)
        toast.success("Recording stopped")
      } else {
        await startRecording(deviceId, streamKey)
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
          [...activeByStream.values()].map((r) =>
            stopRecording(deviceId, r.id)
          )
        )
        toast.success("All recordings stopped")
      } else {
        await startAllRecordings(deviceId)
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

  if (loadError) {
    return <p className="text-destructive text-sm">{loadError}</p>
  }

  if (channels === null) {
    return (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Skeleton className="aspect-video max-h-[40vh] w-full" />
        <Skeleton className="aspect-video max-h-[40vh] w-full" />
      </div>
    )
  }

  if (channels.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No live video channels. Provision the device to enable streaming.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant={allRecording ? "destructive" : "default"}
          disabled={allBusy}
          onClick={toggleAll}
        >
          {allBusy ? "…" : allRecording ? "Stop all" : "Record all"}
        </Button>
      </div>
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
    </div>
  )
}
