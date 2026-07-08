import type { ReactNode } from "react"
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react"
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
  title,
  action,
  footer,
  pinFirstColumn = false,
  sortDir,
  onToggleSort,
  fillHeight = false,
}: {
  history: HistoryPoint[]
  metrics: string[]
  units: Record<string, string>
  // When omitted (and no `action`), the card header is dropped entirely.
  title?: string
  action?: ReactNode
  // Rendered inside the card, below the (horizontally scrollable) table.
  footer?: ReactNode
  // Keep the Time column visible while the metric columns scroll horizontally.
  pinFirstColumn?: boolean
  // When set, the Time header becomes a sort toggle and `history` is rendered
  // as-is (the caller controls order). Without it the table reverses to show the
  // most recent first (assuming ascending input) — the Overview behaviour.
  sortDir?: "asc" | "desc"
  onToggleSort?: () => void
  // Fill the parent's height: the card flexes, the table body scrolls with a
  // sticky header row, and the footer pins to the bottom. The parent must give
  // this component a bounded height.
  fillHeight?: boolean
}) {
  // Sortable callers hand us rows already in display order; otherwise the input
  // is ascending and we reverse to show the most recent first.
  const rows = sortDir ? history : [...history].reverse()

  const baseHead = "text-[10px] tracking-[0.14em] uppercase text-muted-foreground"

  // Sticky first column (opaque bg so scrolling columns don't show through) and,
  // in fillHeight mode, a sticky header row. z-order: corner > header > body-pin.
  const pinBodyCls = pinFirstColumn
    ? "sticky left-0 z-10 bg-card border-r border-border"
    : ""
  const timeHeadCls = cn(
    baseHead,
    pinFirstColumn && "sticky left-0 bg-card border-r border-border",
    fillHeight && "sticky top-0 bg-card",
    pinFirstColumn && fillHeight
      ? "z-30"
      : pinFirstColumn
        ? "z-10"
        : fillHeight
          ? "z-20"
          : ""
  )
  const metricHeadCls = cn(
    "text-right",
    baseHead,
    fillHeight && "sticky top-0 z-20 bg-card"
  )

  return (
    <Card
      className={
        fillHeight ? "flex h-full flex-col gap-0 overflow-hidden py-0" : undefined
      }
    >
      {title || action ? (
        <CardHeader className={cn("pb-2", fillHeight && "px-4 pt-4")}>
          {title ? <CardTitle className="text-sm">{title}</CardTitle> : null}
          {action ? <CardAction>{action}</CardAction> : null}
        </CardHeader>
      ) : null}
      <CardContent
        className={fillHeight ? "flex min-h-0 flex-1 flex-col p-0" : undefined}
      >
        <Table
          containerClassName={fillHeight ? "min-h-0 flex-1 overflow-auto" : undefined}
        >
          <TableHeader>
            <TableRow>
              <TableHead className={timeHeadCls}>
                {onToggleSort ? (
                  <button
                    type="button"
                    onClick={onToggleSort}
                    className="-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 tracking-[0.14em] uppercase transition-colors hover:text-foreground"
                  >
                    Time
                    {sortDir === "asc" ? (
                      <ArrowUpIcon className="size-3" />
                    ) : (
                      <ArrowDownIcon className="size-3" />
                    )}
                  </button>
                ) : (
                  "Time"
                )}
              </TableHead>
              {metrics.map((m) => (
                <TableHead key={m} className={metricHeadCls}>
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
                    pinBodyCls
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
        {footer ? (
          <div
            className={
              fillHeight
                ? "shrink-0 border-t border-border px-3 py-3"
                : "mt-3"
            }
          >
            {footer}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
