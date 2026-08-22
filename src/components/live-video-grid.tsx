import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { xgMessage } from "@/lib/xorgate"
import { selectStreamTile } from "@/lib/live-block"
import { UnavailableStreamTile } from "@/components/unavailable-stream-tile"
import {
  useLiveVideo,
  useVideoChannels,
  type LiveBlockState,
  type LiveVideoStatus,
  type LiveVideoStats,
  type VideoChannel,
} from "@xorgate/react"

// Live-status dot shown top-left of each tile, in place of a text badge. Green =
// connected, amber (pulsing) = transient states (connecting / reconnecting), light
// gray = waiting for the device, red = error. The label rides along as a tooltip +
// aria-label so the meaning stays accessible without taking up space.
const STATUS_META: Record<
  LiveVideoStatus,
  { label: string; dot: string; pulse: boolean }
> = {
  connecting: { label: "Connecting", dot: "bg-amber-400", pulse: true },
  waiting: { label: "Waiting for device", dot: "bg-zinc-300", pulse: false },
  connected: { label: "Live", dot: "bg-green-500", pulse: false },
  closed: { label: "Reconnecting", dot: "bg-amber-400", pulse: true },
  error: { label: "Error", dot: "bg-red-500", pulse: false },
  unavailable: { label: "Live video unavailable", dot: "bg-zinc-400", pulse: false },
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
function formatStreamSpec(stats: LiveVideoStats | null): string | null {
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
  channel: VideoChannel
  label: string
  // On-device video recording is a device-level flag (media.recording.value),
  // not per-camera, so every tile shows the dot while the device is recording.
  recordingOnDevice: boolean
}) {
  const { videoRef, status, error, stats } = useLiveVideo(channel)
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
          <p className="p-2 text-xs text-destructive">{xgMessage(error)}</p>
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
  cameraEnables,
  liveBlock,
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
  // Already-resolved live-stream block verdict (power management plan, Phase
  // 3). The grid does NOT derive it: fail-open, staleness and the reason
  // registry all live in lib/live-block.ts, so this component only chooses
  // which tile to render. Absent = treat as allowed.
  liveBlock?: LiveBlockState
}) {
  const { data: channels, error: loadError } = useVideoChannels(deviceId)

  const labelFor = (streamKey: string) =>
    videoCaps.find((c) => c.key === streamKey)?.label ?? streamKey

  let body
  if (loadError) {
    body = <p className="text-sm text-destructive">{xgMessage(loadError)}</p>
  } else if (channels === undefined) {
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
        {channels.map((ch) => {
          // Precedence (disabled > blocked > player) is decided in one pure
          // function so it can be tested without a DOM. Anything other than
          // "player" leaves `useKvsViewer` unmounted, which is the entire
          // guarantee: nothing loops against a master the device killed.
          const tile = selectStreamTile({
            streamKey: ch.streamKey,
            label: labelFor(ch.streamKey),
            cameraEnables,
            liveBlock: liveBlock ?? { blocked: false, why: "no-live-block" },
          })
          return tile.kind === "player" ? (
            <LiveVideoTile
              key={ch.channelRef}
              channel={ch}
              label={labelFor(ch.streamKey)}
              recordingOnDevice={recordingOnDevice}
            />
          ) : (
            <UnavailableStreamTile
              key={ch.channelRef}
              deviceId={deviceId}
              descriptor={tile.descriptor}
            />
          )
        })}
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
