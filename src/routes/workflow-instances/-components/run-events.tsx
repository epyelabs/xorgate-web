import { FilmIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { DataTable, type DataTableColumn } from "@/components/data-table"
import type { RunEvent } from "@/lib/workflow-run-schemas"

const columns: DataTableColumn<RunEvent>[] = [
  {
    id: "kind",
    header: "Kind",
    headClassName: "pl-3",
    cellClassName: "pl-3",
    cell: (event) => <span className="font-mono text-xs">{event.kind}</span>,
  },
  {
    id: "at",
    header: "At",
    cellClassName: "text-muted-foreground tabular-nums",
    cell: (event) => event.occurredAt,
  },
  {
    id: "confidence",
    header: "Confidence",
    cell: (event) => (
      <Badge variant="secondary">{Math.round(event.confidence * 100)}%</Badge>
    ),
  },
  {
    id: "payload",
    header: "Payload",
    cellClassName: "max-w-72 truncate text-muted-foreground",
    cell: (event) => event.payloadSummary,
  },
  {
    id: "evidence",
    header: "Evidence",
    align: "right",
    cell: (event) =>
      event.clip ? (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <FilmIcon className="size-3.5" />
          clip
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
  },
]

export function RunEvents({ events }: { events: RunEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-8 text-center">
        <p className="text-xs text-muted-foreground">
          No events produced by this run.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border">
      <DataTable
        card={false}
        columns={columns}
        rows={events}
        getRowKey={(event) => event.id}
      />
    </div>
  )
}
