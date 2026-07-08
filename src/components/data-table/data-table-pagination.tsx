import type { ReactNode } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ExportCsvButton } from "./export-csv-button"

const DEFAULT_PAGE_SIZES = [25, 50, 100, 200]

// Footer pagination controls extracted from the telemetry table: a standard
// "Export CSV" action on the far left, and a "Rows" page-size select, an
// "X–Y of N" range readout, and Prev/Next on the right. The `left` slot holds
// any additional bottom-left content.
export interface DataTablePaginationProps {
  page: number
  pageSize: number
  total: number
  // Number of rows actually rendered on the current page (for the range readout).
  rowsOnPage: number
  pageSizes?: number[]
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  loading?: boolean
  // Standard Export CSV action (rendered bottom-left, matching the telemetry table).
  onExportCsv?: () => void
  exporting?: boolean
  exportDisabled?: boolean
  left?: ReactNode
}

export function DataTablePagination({
  page,
  pageSize,
  total,
  rowsOnPage,
  pageSizes = DEFAULT_PAGE_SIZES,
  onPageChange,
  onPageSizeChange,
  loading = false,
  onExportCsv,
  exporting = false,
  exportDisabled = false,
  left,
}: DataTablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const hasPrev = page > 1
  const hasNext = page < totalPages
  const startIdx = total === 0 ? 0 : (page - 1) * pageSize + 1
  const endIdx = (page - 1) * pageSize + rowsOnPage

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {onExportCsv ? (
          <ExportCsvButton
            onClick={onExportCsv}
            exporting={exporting}
            disabled={exportDisabled}
          />
        ) : null}
        {left}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Rows</span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => onPageSizeChange(Number(v))}
          >
            <SelectTrigger className="h-8 w-[74px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizes.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {total > 0 ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {startIdx.toLocaleString()}–{endIdx.toLocaleString()} of{" "}
            {total.toLocaleString()}
          </span>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={!hasPrev || loading}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeftIcon />
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={!hasNext || loading}
            onClick={() => onPageChange(page + 1)}
          >
            Next
            <ChevronRightIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}
