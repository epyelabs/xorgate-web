import { formatBytes } from "@/components/data-table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { DeviceRecordingStatus } from "@/hooks/use-iot-telemetry"

// On-device upload-backlog status, driven by the live payload's `recording`
// block (offline recording plan, Phase 5). Formerly device-recording-indicator,
// which conflated "recording now" with "upload backlog"; the recording half now
// lives as a per-player red dot in live-video-grid.tsx, leaving this as a
// purely ambient backlog/uploading badge.
//
// It rides right-aligned on the device tab-bar row ($id.tsx), so it costs no
// vertical space and stays visible from every tab. Deliberately AMBIENT: it
// says "N queued / uploading now" and nothing else. Attention-needing
// conditions (dropped segments) surface through the header DeviceAlertsButton
// instead — do not duplicate them here.
//
// Renders nothing when there is no backlog and nothing uploading; a permanent
// chip in the tab row would just be noise.
export function DeviceBacklogBadge({
  recording,
}: {
  recording: DeviceRecordingStatus | null
}) {
  if (!recording) return null

  const backlog = recording.backlogSegments > 0
  if (!backlog && !recording.uploading) return null

  const size = formatBytes(recording.backlogBytes)
  const segments = `${recording.backlogSegments} segment${
    recording.backlogSegments === 1 ? "" : "s"
  }`
  const label = recording.uploading ? `Uploading · ${size}` : `${size} queued`
  const detail = recording.uploading
    ? `Uploading recorded segments — ${size} still queued (${segments}).`
    : `${size} recorded on device awaiting upload (${segments}).`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs whitespace-nowrap text-muted-foreground">
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${
              recording.uploading ? "animate-pulse bg-sky-500" : "bg-amber-400"
            }`}
          />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
  )
}
