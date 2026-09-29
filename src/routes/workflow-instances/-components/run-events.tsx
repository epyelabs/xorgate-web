import { FilmIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { DataTable, type DataTableColumn } from "@/components/data-table"
import { WebhookTargetBadge } from "@/components/webhooks/webhook-target-badge"
import { nodeWebhookNames } from "@/lib/webhooks-api"
import type { RunEvent, RunMode } from "@/lib/workflow-run-schemas"
import type { WorkflowDefinition } from "@/lib/workflow-schemas"

const baseColumns: DataTableColumn<RunEvent>[] = [
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

// The webhook column appears only when some output.event node in the run's
// graph names an endpoint: "routed to x" (production) or "would deliver to x"
// (simulation), from the event's nodeId (engine 0.5.0+).
function webhookColumn(
  mode: RunMode,
  names: Map<string, string>
): DataTableColumn<RunEvent> {
  return {
    id: "webhook",
    header: "Webhook",
    cell: (event) => (
      <WebhookTargetBadge event={event} mode={mode} names={names} />
    ),
  }
}

export function RunEvents({
  events,
  mode,
  definition,
}: {
  events: RunEvent[]
  mode: RunMode
  definition: WorkflowDefinition
}) {
  const names = nodeWebhookNames(definition)
  const columns =
    names.size > 0
      ? [...baseColumns.slice(0, -1), webhookColumn(mode, names), baseColumns[baseColumns.length - 1]]
      : baseColumns
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
