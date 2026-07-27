import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { getKvsChannels, type KvsChannel } from "@/lib/api"
import { getKvsChannelsResponseSchema } from "@/lib/schemas"
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

/**
 * Pulsating red circle marking ON-DEVICE recording, in the lower-right slot the
 * old cloud "Record" button used to occupy. Purely presentational: recording is
 * controlled from Settings → "Record on device", never from the player. The
 * red-pulse styling is lifted from the retired device-recording-indicator badge
 * so the visual language for "recording" stays consistent across the app.
 */
function OnDeviceRecordingDot() {
  return (
    <span
      role="status"
      aria-label="Recording on device"
      title="Recording on device"
      className="inline-block size-2.5 animate-pulse rounded-full bg-red-500 shadow-[0_0_2px_rgba(0,0,0,0.6)] ring-1 ring-white/70"
    />
  )
}

function LiveVideoTile({
  channel,
  label,
  recordingOnDevice,
}: {
  channel: KvsChannel
  label: string
  // On-device video recording is a device-level flag (media.recording.value),
  // not per-camera, so every tile shows the dot while the device is recording.
  recordingOnDevice: boolean
}) {
  const { videoRef, status, error } = useKvsViewer(channel)
  const meta = STATUS_META[status]

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
          </div>
          <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
            {label}
          </div>
          {recordingOnDevice ? (
            <div className="absolute right-2 bottom-2 flex items-center">
              <OnDeviceRecordingDot />
            </div>
          ) : null}
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
 * per channel. Viewing only — the cloud viewer-recorder and its per-tile /
 * "Record all" controls were removed; on-device recording is configured in
 * Settings and merely reflected here by the lower-right red dot.
 */
export function LiveVideoGrid({
  deviceId,
  videoCaps,
  title,
  recordingOnDevice = false,
}: {
  deviceId: string
  videoCaps: { key: string; label?: string }[]
  title?: string
  // Live on-device video recording state (media.recording.value from the
  // telemetry payload). Device-level, so it applies to every tile.
  recordingOnDevice?: boolean
}) {
  const [channels, setChannels] = useState<KvsChannel[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

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

  const labelFor = (streamKey: string) =>
    videoCaps.find((c) => c.key === streamKey)?.label ?? streamKey

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
            recordingOnDevice={recordingOnDevice}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {title ? (
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        </div>
      ) : null}
      {body}
    </div>
  )
}
