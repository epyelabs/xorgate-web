import {
  ClockIcon,
  GaugeIcon,
  VideoIcon,
  type LucideIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ColHead } from "@/routes/workflow-instances/-components/runs-table-parts"
import type { AttachmentTriggerType } from "@/lib/device-workflow-schemas"

const TRIGGER_META: Record<
  AttachmentTriggerType,
  { label: string; icon: LucideIcon }
> = {
  recording_saved: { label: "On recording", icon: VideoIcon },
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

export function AttachmentsSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <ColHead>Workflow</ColHead>
          <ColHead>Version</ColHead>
          <ColHead>Trigger</ColHead>
          <ColHead>State</ColHead>
          <ColHead>Last run</ColHead>
          <ColHead>Runs</ColHead>
          <ColHead> </ColHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 3 }).map((_, i) => (
          <TableRow key={i}>
            <TableCell>
              <Skeleton className="h-4 w-44" />
              <Skeleton className="mt-1 h-3 w-28" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-28" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-24" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-16" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-16" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-6" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-6" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function AttachmentsEmptyState({ onAttach }: { onAttach: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
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
