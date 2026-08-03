import { useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { VideoOffIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { getKvsChannels, type KvsChannel } from "@/lib/api"
import { getKvsChannelsResponseSchema } from "@/lib/schemas"
import {
  useKvsViewer,
  type KvsStatus,
  type KvsStreamStats,
} from "@/hooks/use-kvs-viewer"

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
 * Pulsating REC pill marking ON-DEVICE recording, sitting beside the status dot
 * in the single top-left indicator cluster. Purely presentational: recording is
 * controlled from Settings → "Record on device", never from the player.
 *
 * Deliberately a separate glyph from the status dot rather than a colour of it.
 * The two facts are orthogonal — recording rides on MQTT telemetry, stream
 * status on the KVS peer connection, so either can be healthy while the other
 * is not. Folding recording into the dot's colour would erase "device is still
 * capturing" exactly when the viewer session drops (a routine LTE blip), and
 * would collide with the red the dot already uses for `error`.
 */
function OnDeviceRecordingBadge() {
  return (
    <span
      role="status"
      aria-label="Recording on device"
      title="Recording on device"
      className="flex items-center gap-1.5 rounded bg-black/60 px-2 py-0.5 text-xs font-semibold tracking-wide text-white"
    >
      <span
        aria-hidden="true"
        className="inline-block size-2 animate-pulse rounded-full bg-red-500"
      />
      REC
    </span>
  )
}

/**
 * Text overlays (camera name, stream spec) reveal on hover so the picture stays
 * unobstructed at rest. Gated on `hover: hover` because touch devices have no
 * hover state — there they stay visible, since a hidden-forever label is worse
 * than a covered corner. The top-left indicator cluster is deliberately NOT
 * faded: it carries live state the operator must be able to see at a glance.
 */
const HOVER_REVEAL =
  "transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"

/**
 * Render the measured stream spec as "720p 15fps 1Mbps", dropping any part the
 * browser hasn't reported yet (bitrate needs two samples, so it lags the rest by
 * one interval). Returns null until at least one part is known, so the chip
 * never appears empty.
 */
function formatStreamSpec(stats: KvsStreamStats | null): string | null {
  if (!stats) return null
  const parts: string[] = []
  if (stats.height) parts.push(`${stats.height}p`)
  if (stats.fps) parts.push(`${Math.round(stats.fps)}fps`)
  if (stats.kbps) {
    parts.push(
      stats.kbps >= 1000
        ? `${(stats.kbps / 1000).toFixed(1).replace(/\.0$/, "")}Mbps`
        : `${Math.round(stats.kbps)}kbps`
    )
  }
  return parts.length > 0 ? parts.join(" ") : null
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
  const { videoRef, status, error, stats } = useKvsViewer(channel)
  const meta = STATUS_META[status]
  const spec = formatStreamSpec(stats)

  return (
    <Card className="overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="group relative aspect-video max-h-[40vh] w-full bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
          />
          {/* Single indicator cluster: stream status + on-device recording. */}
          <div className="absolute top-2 left-2 flex items-center gap-1.5">
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
            {recordingOnDevice ? <OnDeviceRecordingBadge /> : null}
          </div>
          <div
            className={cn(
              "absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white",
              HOVER_REVEAL
            )}
          >
            {label}
          </div>
          {spec ? (
            <span
              title="Live stream: resolution, frame rate, bitrate"
              className={cn(
                "absolute right-2 bottom-2 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white tabular-nums",
                HOVER_REVEAL
              )}
            >
              {spec}
            </span>
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
 * Stand-in for a camera the operator turned off in Settings
 * (`recording.video.cameras[streamKey] === false`). Deliberately NOT a player:
 * a disabled camera has no KVS master on the device (the agent parks it), so
 * mounting a viewer here would only produce a black tile plus an endless
 * offer/timeout/backoff loop against KVS + Cognito. Rendering this instead of
 * <LiveVideoTile> keeps `useKvsViewer` unmounted, so nothing reconnects.
 */
function DisabledCameraTile({
  deviceId,
  label,
}: {
  deviceId: string
  label: string
}) {
  return (
    <Card className="overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="bg-muted/40 flex aspect-video max-h-[40vh] w-full flex-col items-center justify-center gap-2 px-6 text-center">
          <VideoOffIcon
            aria-hidden="true"
            className="text-muted-foreground size-6"
          />
          <p className="text-sm font-medium">{label} is turned off</p>
          <Link
            to="/devices/$id/settings"
            params={{ id: deviceId }}
            className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4 transition-colors"
          >
            Open device settings
          </Link>
        </div>
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
  cameraEnables,
}: {
  deviceId: string
  videoCaps: { key: string; label?: string }[]
  title?: string
  // Live on-device video recording state (media.recording.value from the
  // telemetry payload). Device-level, so it applies to every tile.
  recordingOnDevice?: boolean
  // Per-camera enables from the device's recording config
  // (recordingConfig.video.cameras), keyed by stream key. An absent key means
  // enabled, so `{}` / undefined = every camera on.
  cameraEnables?: Record<string, boolean>
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
        {channels.map((ch) =>
          cameraEnables?.[ch.streamKey] === false ? (
            <DisabledCameraTile
              key={ch.channelArn}
              deviceId={deviceId}
              label={labelFor(ch.streamKey)}
            />
          ) : (
            <LiveVideoTile
              key={ch.channelArn}
              channel={ch}
              label={labelFor(ch.streamKey)}
              recordingOnDevice={recordingOnDevice}
            />
          )
        )}
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
