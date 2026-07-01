import type { ReactNode } from "react"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { HistoryPoint } from "@/hooks/use-iot-telemetry"
import { formatDateTime } from "@/lib/format-time"
import { formatMetricValue, metricLabel } from "@/lib/telemetry-meta"
import { cn } from "@/lib/utils"

export function TelemetryTable({
  history,
  metrics,
  units,
  title = "Readings",
  action,
  footer,
  pinFirstColumn = false,
}: {
  history: HistoryPoint[]
  metrics: string[]
  units: Record<string, string>
  title?: string
  action?: ReactNode
  // Rendered inside the card, below the (horizontally scrollable) table.
  footer?: ReactNode
  // Keep the Time column visible while the metric columns scroll horizontally.
  pinFirstColumn?: boolean
}) {
  // Hook sorts ascending; show most recent buckets first.
  const rows = [...history].reverse()

  // Sticky first column. Needs an opaque background (bg-card) so the scrolling
  // columns don't show through, and a right divider for separation.
  const pinCls = pinFirstColumn
    ? "sticky left-0 z-10 bg-card border-r border-border"
    : ""

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className={cn(
                  "text-[10px] tracking-[0.14em] uppercase text-muted-foreground",
                  pinCls
                )}
              >
                Time
              </TableHead>
              {metrics.map((m) => (
                <TableHead
                  key={m}
                  className="text-right text-[10px] tracking-[0.14em] uppercase text-muted-foreground"
                >
                  {metricLabel(m)}
                  {units[m] ? ` (${units[m]})` : ""}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((point) => (
              <TableRow key={point.ts}>
                <TableCell
                  className={cn(
                    "text-xs text-muted-foreground tabular-nums",
                    pinCls
                  )}
                >
                  {formatDateTime(point.ts)}
                </TableCell>
                {metrics.map((m) => {
                  const value = point[m]
                  return (
                    <TableCell
                      key={m}
                      className="text-right text-xs tabular-nums"
                    >
                      {typeof value === "number"
                        ? formatMetricValue(value, m)
                        : "—"}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {footer ? <div className="mt-3">{footer}</div> : null}
      </CardContent>
    </Card>
  )
}
