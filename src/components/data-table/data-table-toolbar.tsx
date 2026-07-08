import type { ReactNode } from "react"
import { SearchIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// Shared toolbar for the tables. Left cluster: filter controls (date range,
// status dropdowns, preset chips). Right cluster (ml-auto): an optional result
// counter and a search box. Search can be aligned left (the list-page default)
// or right (media / workflows). Both features are opt-in — a table only shows
// what it configures. (Export CSV lives in the footer via DataTablePagination,
// matching the telemetry table.)
export interface DataTableToolbarProps {
  search?: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
  }
  // Where the search box sits. Defaults to the left cluster.
  searchAlign?: "left" | "right"
  // Filter controls rendered in the left cluster.
  filters?: ReactNode
  // Extra left-aligned controls after the filters.
  children?: ReactNode
  // Right-aligned informational content (e.g. a "Showing X of N" counter).
  right?: ReactNode
  className?: string
}

export function DataTableToolbar({
  search,
  searchAlign = "left",
  filters,
  children,
  right,
  className,
}: DataTableToolbarProps) {
  const searchNode = search ? (
    <div
      className={cn(
        "relative",
        searchAlign === "left" ? "w-full max-w-sm" : "w-full sm:w-56"
      )}
    >
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={search.value}
        onChange={(e) => search.onChange(e.target.value)}
        placeholder={search.placeholder ?? "Filter…"}
        className={cn("pl-7", searchAlign === "right" && "h-8")}
      />
    </div>
  ) : null

  const hasRightCluster =
    right != null || (searchAlign === "right" && searchNode != null)

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {searchAlign === "left" ? searchNode : null}
      {filters}
      {children}
      {hasRightCluster ? (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {right != null ? (
            <span className="text-xs text-muted-foreground">{right}</span>
          ) : null}
          {searchAlign === "right" ? searchNode : null}
        </div>
      ) : null}
    </div>
  )
}
