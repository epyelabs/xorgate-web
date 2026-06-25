import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { RunStatus } from "@/lib/workflow-run-schemas"

const STATUS_DOT: Record<RunStatus, string> = {
  succeeded: "bg-emerald-500",
  running: "bg-sky-500 animate-pulse",
  failed: "bg-destructive",
}

export function RunStatusCell({ status }: { status: RunStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      <span className="text-xs">{status}</span>
    </span>
  )
}

export function ColHead({ children }: { children: React.ReactNode }) {
  return (
    <TableHead className="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
      {children}
    </TableHead>
  )
}

export function RunsTableSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <ColHead>Device</ColHead>
          <ColHead>Template</ColHead>
          <ColHead>Trigger</ColHead>
          <ColHead>Status</ColHead>
          <ColHead>Started</ColHead>
          <ColHead>Duration</ColHead>
          <ColHead>Events</ColHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 5 }).map((_, i) => (
          <TableRow key={i}>
            <TableCell>
              <Skeleton className="h-4 w-20" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-44" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-16" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-20" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-12" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-10" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-8" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
      <p className="text-sm font-medium">No runs in this workspace yet</p>
      <p className="text-xs text-muted-foreground">
        Runs appear here when a workflow attached to a device executes.
      </p>
    </div>
  )
}

export function FilteredEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
      <p className="text-sm text-muted-foreground">
        No runs match the current filters.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="text-xs text-primary underline-offset-2 hover:underline"
      >
        Clear filters
      </button>
    </div>
  )
}

// Formats a run duration (ms) as a compact "42s" / "1m 12s" / "—".
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—"
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return sec === 0 ? `${min}m` : `${min}m ${sec}s`
}
