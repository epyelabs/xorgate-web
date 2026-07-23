import { formatBytes } from "@/components/data-table"
import type {
  DeviceMediaStatus,
  DeviceRecordingStatus,
} from "@/hooks/use-iot-telemetry"

// On-device recording / upload-backlog status, driven by the live payload's
// `recording` block (offline recording plan, Phase 5). Renders nothing until
// there is something worth saying: recording active, backlog pending, or
// uploading. Style follows CaptureIndicator (live-video-grid.tsx) but sits
// inline on the page, not over a video tile. Attention-needing conditions
// (e.g. dropped segments) surface through the header DeviceAlertsButton, not
// here — this strip is status, not warnings.
export function DeviceRecordingIndicator({
  recording,
  media,
}: {
  recording: DeviceRecordingStatus | null
  media: DeviceMediaStatus | null
}) {
  if (!recording) return null

  const videoActive = media?.recording?.value === true
  const active = recording.enabled || videoActive
  const backlog = recording.backlogSegments > 0

  if (!active && !backlog) return null

  const parts: string[] = []
  if (active) {
    const what =
      recording.enabled && videoActive
        ? "telemetry + video"
        : videoActive
          ? "video"
          : "telemetry"
    parts.push(`Recording ${what} on device`)
  }
  if (recording.uploading) {
    parts.push(
      `uploading · ${formatBytes(recording.backlogBytes)} queued (${recording.backlogSegments} segments)`
    )
  } else if (backlog) {
    parts.push(
      `${formatBytes(recording.backlogBytes)} awaiting upload (${recording.backlogSegments} segments)`
    )
  }

  if (parts.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-muted-foreground">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            active
              ? "animate-pulse bg-red-500"
              : recording.uploading
                ? "animate-pulse bg-sky-500"
                : "bg-amber-400"
          }`}
        />
        {parts.join(" · ")}
      </span>
    </div>
  )
}
