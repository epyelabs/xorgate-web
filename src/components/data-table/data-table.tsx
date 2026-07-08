import { useState, type ReactNode } from "react"
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react"
import { toast } from "sonner"

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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

import { isRightAligned, type DataTableColumn } from "./columns"
import { toCsv, downloadCsv } from "./csv"
import { DataTablePagination } from "./data-table-pagination"
import { ExportCsvButton } from "./export-csv-button"

// The uppercase micro-label shared by every table header (previously copied as
// `baseHead` / `ColHead` across four files).
const HEAD_BASE = "text-[10px] tracking-[0.14em] uppercase text-muted-foreground"

export interface DataTableSort {
  columnId: string
  dir: "asc" | "desc"
}

// Built-in pagination config. When set, DataTable renders the standard footer
// (page-size select, "X–Y of N", Prev/Next) itself — the caller passes config,
// not JSX.
export interface DataTablePaginationConfig {
  page: number
  pageSize: number
  total: number
  rowsOnPage?: number // defaults to the rendered row count
  pageSizes?: number[]
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

// Built-in CSV export config. When set, DataTable renders the standard
// "Export CSV" button (footer, bottom-left) and generates the file itself from
// the columns' `csvValue`. Provide `getRows` to export the full (server-paged)
// dataset; omit it to export the currently rendered `rows`.
export interface DataTableExportConfig<Row> {
  filename: string
  getRows?: () => Row[] | Promise<Row[]>
}

// Optional row-selection: renders a leading checkbox column (header = select-all
// with indeterminate state) and marks selected rows via data-state="selected".
export interface DataTableSelection<Row> {
  isSelected: (row: Row) => boolean
  onToggle: (row: Row) => void
  allSelected: boolean
  someSelected: boolean
  onToggleAll: () => void
  rowLabel?: (row: Row) => string
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[]
  rows: Row[]
  getRowKey: (row: Row, index: number) => string | number

  // States. `loading` shows skeleton rows; an empty result renders `empty` (or
  // `filteredEmpty` when `isFiltered`) in place of the table body.
  loading?: boolean
  skeletonRows?: number
  empty?: ReactNode
  filteredEmpty?: ReactNode
  isFiltered?: boolean

  // Single-column sort. The caller drives ordering (server- or client-side); the
  // DataTable only reflects `sort` in the header and calls back on click.
  sort?: DataTableSort
  onToggleSort?: (columnId: string) => void

  selection?: DataTableSelection<Row>
  // Highlight a row without a selection checkbox (sets data-state="selected",
  // e.g. the currently-loaded template version).
  rowState?: (row: Row) => "selected" | undefined

  // Built-in footer features. `pagination` renders the standard pagination bar;
  // `exportCsv` adds the standard Export CSV button (bottom-left) and generates
  // the file from the columns' `csvValue`.
  pagination?: DataTablePaginationConfig
  exportCsv?: DataTableExportConfig<Row>

  // Card slots + layout.
  title?: string
  action?: ReactNode
  toolbar?: ReactNode // rendered above the table, inside the card
  footer?: ReactNode // extra footer content (used when there is no `pagination`)
  fillHeight?: boolean // flex-fill the parent; sticky header, pinned footer
  card?: boolean // wrap in a Card (default). false => bare, for embedding.

  onRowClick?: (row: Row) => void
  className?: string
}

function DefaultEmpty({ children }: { children?: ReactNode }) {
  return (
    <p className="py-10 text-center text-sm text-muted-foreground">
      {children ?? "No data yet."}
    </p>
  )
}

function headClass<Row>(col: DataTableColumn<Row>, fillHeight: boolean): string {
  const right = isRightAligned(col)
  return cn(
    HEAD_BASE,
    right && "text-right",
    col.align === "center" && "text-center",
    // Pinned first column: opaque bg so scrolling columns don't show through.
    col.pinned && "sticky left-0 bg-card border-r border-border",
    fillHeight && "sticky top-0 bg-card",
    // z-order: sticky corner (pin + fill) > header row > pinned body cell.
    col.pinned && fillHeight
      ? "z-30"
      : col.pinned
        ? "z-10"
        : fillHeight
          ? "z-20"
          : "",
    col.headClassName
  )
}

function cellClass<Row>(col: DataTableColumn<Row>): string {
  const right = isRightAligned(col)
  return cn(
    "text-xs",
    right && "text-right tabular-nums",
    col.align === "center" && "text-center",
    col.pinned && "sticky left-0 z-10 bg-card border-r border-border",
    col.cellClassName
  )
}

function HeaderCell<Row>({
  col,
  sort,
  onToggleSort,
}: {
  col: DataTableColumn<Row>
  sort?: DataTableSort
  onToggleSort?: (columnId: string) => void
}) {
  if (!col.sortable || !onToggleSort) return <>{col.header}</>
  const active = sort?.columnId === col.id
  return (
    <button
      type="button"
      onClick={() => onToggleSort(col.id)}
      className="-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 tracking-[0.14em] uppercase transition-colors hover:text-foreground"
    >
      {col.header}
      {active ? (
        sort.dir === "asc" ? (
          <ArrowUpIcon className="size-3" />
        ) : (
          <ArrowDownIcon className="size-3" />
        )
      ) : (
        <ChevronsUpDownIcon className="size-3 opacity-40" />
      )}
    </button>
  )
}

export function DataTable<Row>({
  columns,
  rows,
  getRowKey,
  loading = false,
  skeletonRows = 5,
  empty,
  filteredEmpty,
  isFiltered = false,
  sort,
  onToggleSort,
  selection,
  rowState,
  pagination,
  exportCsv,
  title,
  action,
  toolbar,
  footer,
  fillHeight = false,
  card = true,
  onRowClick,
  className,
}: DataTableProps<Row>) {
  const [exporting, setExporting] = useState(false)
  const showEmpty = !loading && rows.length === 0
  const selectHeadCls = cn(
    "w-8 pl-3",
    fillHeight && "sticky top-0 z-20 bg-card"
  )

  // Standard CSV export: build the file from the columns that declare `csvValue`.
  const csvColumns = columns.filter((c) => c.csvValue)
  const exportEmpty = pagination ? pagination.total === 0 : rows.length === 0

  const handleExportCsv = async () => {
    if (!exportCsv) return
    setExporting(true)
    try {
      const data = exportCsv.getRows ? await exportCsv.getRows() : rows
      const header = csvColumns.map(
        (c) => c.csvHeader ?? (typeof c.header === "string" ? c.header : c.id)
      )
      const body = data.map((row) => csvColumns.map((c) => c.csvValue!(row)))
      downloadCsv(toCsv(header, body), exportCsv.filename)
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`)
    } finally {
      setExporting(false)
    }
  }

  const emptyNode = isFiltered
    ? (filteredEmpty ?? <DefaultEmpty>No matches for the current filters.</DefaultEmpty>)
    : (empty ?? <DefaultEmpty />)

  const table = (
    <Table
      containerClassName={fillHeight ? "min-h-0 flex-1 overflow-auto" : undefined}
    >
      <TableHeader>
        <TableRow>
          {selection ? (
            <TableHead className={selectHeadCls}>
              <input
                type="checkbox"
                aria-label="Select all"
                className="size-3.5 cursor-pointer align-middle accent-primary"
                checked={selection.allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = selection.someSelected
                }}
                onChange={selection.onToggleAll}
              />
            </TableHead>
          ) : null}
          {columns.map((col) => (
            <TableHead
              key={col.id}
              className={headClass(col, fillHeight)}
              style={col.width ? { width: col.width } : undefined}
            >
              <HeaderCell col={col} sort={sort} onToggleSort={onToggleSort} />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading
          ? Array.from({ length: skeletonRows }).map((_, i) => (
              <TableRow key={`skeleton-${i}`}>
                {selection ? (
                  <TableCell className="w-8 pl-3">
                    <Skeleton className="size-3.5" />
                  </TableCell>
                ) : null}
                {columns.map((col) => (
                  <TableCell key={col.id} className={cellClass(col)}>
                    <Skeleton className="h-4 w-full max-w-[80px]" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          : rows.map((row, i) => (
              <TableRow
                key={getRowKey(row, i)}
                data-state={
                  selection?.isSelected(row) || rowState?.(row) === "selected"
                    ? "selected"
                    : undefined
                }
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? "cursor-pointer" : undefined}
              >
                {selection ? (
                  <TableCell className="w-8 pl-3">
                    <input
                      type="checkbox"
                      aria-label={selection.rowLabel?.(row) ?? "Select row"}
                      className="size-3.5 cursor-pointer align-middle accent-primary"
                      checked={selection.isSelected(row)}
                      onChange={() => selection.onToggle(row)}
                    />
                  </TableCell>
                ) : null}
                {columns.map((col) => (
                  <TableCell key={col.id} className={cellClass(col)}>
                    {col.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
      </TableBody>
    </Table>
  )

  // Footer region: DataTable owns pagination + the standard Export CSV button so
  // callers pass config, not JSX. A plain `footer` node (no pagination/export) is
  // rendered as-is (e.g. the telemetry table's custom footer).
  const footerNode: ReactNode = pagination ? (
    <DataTablePagination
      page={pagination.page}
      pageSize={pagination.pageSize}
      total={pagination.total}
      rowsOnPage={pagination.rowsOnPage ?? rows.length}
      pageSizes={pagination.pageSizes}
      onPageChange={pagination.onPageChange}
      onPageSizeChange={pagination.onPageSizeChange}
      loading={loading}
      onExportCsv={exportCsv ? handleExportCsv : undefined}
      exporting={exporting}
      exportDisabled={exportEmpty}
      left={footer}
    />
  ) : exportCsv ? (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <ExportCsvButton
        onClick={handleExportCsv}
        exporting={exporting}
        disabled={exportEmpty}
      />
      {footer ? <div>{footer}</div> : null}
    </div>
  ) : (
    (footer ?? null)
  )

  // Framed (card) tables use bordered toolbar/footer bars flush to the card edges
  // — the telemetry look — for both fill and non-fill height. Bare (embedded)
  // tables use plain margins so they sit cleanly inside a host container.
  const toolbarCls = card
    ? cn("border-b border-border px-3 py-3", fillHeight && "shrink-0")
    : "mb-3"
  const footerCls = card
    ? cn("border-t border-border px-3 py-3", fillHeight && "shrink-0")
    : "mt-3"
  const emptyCls = fillHeight
    ? "flex min-h-0 flex-1 items-center justify-center"
    : card
      ? "px-3 py-2"
      : undefined

  const inner = (
    <>
      {toolbar ? <div className={toolbarCls}>{toolbar}</div> : null}
      {showEmpty ? <div className={emptyCls}>{emptyNode}</div> : table}
      {footerNode ? <div className={footerCls}>{footerNode}</div> : null}
    </>
  )

  if (!card) {
    return (
      <div
        className={cn("flex flex-col", fillHeight && "h-full min-h-0", className)}
      >
        {inner}
      </div>
    )
  }

  return (
    <Card
      className={cn(
        "gap-0 overflow-hidden py-0",
        fillHeight && "flex h-full flex-col",
        className
      )}
    >
      {title || action ? (
        <CardHeader className="px-4 pt-4 pb-3">
          {title ? <CardTitle className="text-sm">{title}</CardTitle> : null}
          {action ? <CardAction>{action}</CardAction> : null}
        </CardHeader>
      ) : null}
      <CardContent className={cn("flex flex-col p-0", fillHeight && "min-h-0 flex-1")}>
        {inner}
      </CardContent>
    </Card>
  )
}
