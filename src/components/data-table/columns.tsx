import type { ReactNode } from "react"

// A single column definition for the shared DataTable. Presentation-only: the
// caller owns data fetching, sorting and pagination and hands us rows + a `cell`
// renderer per column. Modelled on the telemetry table's column set.
export interface DataTableColumn<Row> {
  // Stable id — used as the React key and as the sort key passed to onToggleSort.
  id: string
  header: ReactNode
  cell: (row: Row) => ReactNode
  // Right-aligned numeric columns get `tabular-nums`. `numeric` is shorthand for
  // `align: "right"` and reads better at call sites for value columns.
  align?: "left" | "right" | "center"
  numeric?: boolean
  // Sticky-left first column that stays visible while the rest scroll (the
  // telemetry "Time" column). Usually only the first column.
  pinned?: boolean
  // Renders the header as a sort toggle. The active direction comes from the
  // DataTable `sort` prop; clicking calls `onToggleSort(column.id)`.
  sortable?: boolean
  headClassName?: string
  cellClassName?: string
  width?: string
  // CSV export: the raw value for this column (cells render ReactNodes, so
  // export needs a plain value). A column is included in the export only if it
  // defines `csvValue`. Header defaults to `csvHeader`, else the string header,
  // else the column id.
  csvValue?: (row: Row) => string | number | null | undefined
  csvHeader?: string
}

export function isRightAligned<Row>(col: DataTableColumn<Row>): boolean {
  return col.align === "right" || (Boolean(col.numeric) && col.align == null)
}

// Compact duration: "42s" / "1m" / "1m 12s" / "—". Promoted from the copies in
// runs-table-parts.tsx and recordings-table.tsx.
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return "—"
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return sec === 0 ? `${min}m` : `${min}m ${sec}s`
}

// Human-readable byte size: "512 B" / "1.5 KB" / "20.4 MB" / "—". Promoted from
// recordings-table.tsx.
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
