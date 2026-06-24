import { FilmIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { RunEvent } from "@/lib/workflow-run-schemas"

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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-3 text-[10px] tracking-[0.14em] uppercase">
              Kind
            </TableHead>
            <TableHead className="text-[10px] tracking-[0.14em] uppercase">
              At
            </TableHead>
            <TableHead className="text-[10px] tracking-[0.14em] uppercase">
              Confidence
            </TableHead>
            <TableHead className="text-[10px] tracking-[0.14em] uppercase">
              Payload
            </TableHead>
            <TableHead className="text-right text-[10px] tracking-[0.14em] uppercase">
              Evidence
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => (
            <TableRow key={event.id}>
              <TableCell className="pl-3">
                <span className="font-mono text-xs">{event.kind}</span>
              </TableCell>
              <TableCell className="text-xs tabular-nums text-muted-foreground">
                {event.occurredAt}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">
                  {Math.round(event.confidence * 100)}%
                </Badge>
              </TableCell>
              <TableCell className="max-w-72 truncate text-xs text-muted-foreground">
                {event.payloadSummary}
              </TableCell>
              <TableCell className="text-right">
                {event.clip ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <FilmIcon className="size-3.5" />
                    clip
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
