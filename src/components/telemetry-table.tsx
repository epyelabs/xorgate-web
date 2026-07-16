import type { ReactNode } from "react"

import { DataTable, type DataTableColumn } from "@/components/data-table"
import type { HistoryPoint } from "@/hooks/use-iot-telemetry"
import { formatDateTime } from "@/lib/format-time"
import { formatMetricValue, formatUnit, metricLabel } from "@/lib/telemetry-meta"

// Thin adapter over the shared DataTable: maps pivoted telemetry rows + the
// capability-derived metric keys into DataTable columns. Kept as its own
// component so the two callers (the Telemetry tab and the Overview "recent
// recorded telemetry" card) keep their existing telemetry-specific API.
export function TelemetryTable({
  history,
  metrics,
  units,
  title,
  action,
  toolbar,
  footer,
  pinFirstColumn = false,
  sortDir,
  onToggleSort,
  fillHeight = false,
  loading = false,
  empty,
}: {
  history: HistoryPoint[]
  metrics: string[]
  units: Record<string, string>
  // When omitted (and no `action`), the card header is dropped entirely.
  title?: string
  action?: ReactNode
  // Rendered inside the card, above the table (the filter toolbar).
  toolbar?: ReactNode
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
  // Loading shows skeleton rows; `empty` renders when there are no rows. Both
  // keep the toolbar + footer visible inside the one card.
  loading?: boolean
  empty?: ReactNode
}) {
  // Sortable callers hand us rows already in display order; otherwise the input
  // is ascending and we reverse to show the most recent first.
  const rows = sortDir ? history : [...history].reverse()

  const columns: DataTableColumn<HistoryPoint>[] = [
    {
      id: "time",
      header: "Time",
      pinned: pinFirstColumn,
      sortable: Boolean(onToggleSort),
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (point) => formatDateTime(point.ts),
    },
    ...metrics.map(
      (m): DataTableColumn<HistoryPoint> => ({
        id: m,
        header: `${metricLabel(m)}${units[m] ? ` (${formatUnit(units[m])})` : ""}`,
        numeric: true,
        cell: (point) => {
          const value = point[m]
          return typeof value === "number" ? formatMetricValue(value, m) : "—"
        },
      })
    ),
  ]

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowKey={(point) => point.ts}
      sort={sortDir ? { columnId: "time", dir: sortDir } : undefined}
      onToggleSort={onToggleSort ? () => onToggleSort() : undefined}
      title={title}
      action={action}
      toolbar={toolbar}
      footer={footer}
      fillHeight={fillHeight}
      loading={loading}
      skeletonRows={12}
      empty={empty}
    />
  )
}
