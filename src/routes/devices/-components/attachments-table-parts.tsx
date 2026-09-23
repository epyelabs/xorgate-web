import {
  ClockIcon,
  GaugeIcon,
  HardDriveDownloadIcon,
  RouteIcon,
  VideoIcon,
  type LucideIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { AttachmentTriggerType } from "@/lib/device-workflow-schemas"

const TRIGGER_META: Record<
  AttachmentTriggerType,
  { label: string; icon: LucideIcon }
> = {
  session_completed: { label: "On device session", icon: HardDriveDownloadIcon },
  segment_uploaded: { label: "On each chunk", icon: VideoIcon },
  telemetry_session_completed: { label: "On telemetry session", icon: RouteIcon },
  schedule: { label: "Scheduled", icon: ClockIcon },
  telemetry_condition: { label: "On condition", icon: GaugeIcon },
}

export function AttachmentTriggerBadge({
  type,
}: {
  type: AttachmentTriggerType
}) {
  const { label, icon: Icon } = TRIGGER_META[type]
  return (
    <Badge variant="secondary">
      <Icon />
      {label}
    </Badge>
  )
}

export function AttachmentStatusCell({ enabled }: { enabled: boolean }) {
  return (
    <Badge variant={enabled ? "default" : "outline"}>
      {enabled ? "enabled" : "paused"}
    </Badge>
  )
}

export function AttachmentVersionCell({
  pinnedVersion,
  runningVersion,
}: {
  pinnedVersion: number | null
  runningVersion: number
}) {
  return (
    <span className="text-xs tabular-nums">
      {pinnedVersion === null ? (
        <span className="text-muted-foreground">
          follows published (v{runningVersion})
        </span>
      ) : (
        <span>pinned v{pinnedVersion}</span>
      )}
    </span>
  )
}

export function AttachmentsEmptyState({ onAttach }: { onAttach: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <p className="text-sm font-medium">No workflows attached yet</p>
      <p className="text-xs text-muted-foreground">
        Attach a workflow template to start producing events from this device&apos;s
        telemetry and recordings.
      </p>
      <button
        type="button"
        onClick={onAttach}
        className="text-xs text-primary underline-offset-2 hover:underline"
      >
        Attach workflow
      </button>
    </div>
  )
}
