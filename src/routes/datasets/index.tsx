import { useEffect, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { toast } from "sonner"
import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DataTable,
  DataTableToolbar,
  type DataTableColumn,
} from "@/components/data-table"
import { StickyHeader } from "@/components/sticky-header"
import { formatRelative } from "@/lib/relative-time"
import { xgMessage } from "@/lib/xorgate"
import { useHasPermission } from "@/lib/permissions"
import type { DatasetSummary } from "@/lib/models-schemas"
import { useDatasets, useInvalidateModels } from "@/queries/models"
import { CreateDatasetDialog } from "./-components/create-dataset-dialog"

export const Route = createFileRoute("/datasets/")({
  beforeLoad: requireAuth,
  component: DatasetsListPage,
})

type SortKey = "updatedAt" | "createdAt" | "name"
const PAGE_SIZES = [25, 50, 100]
const DEFAULT_SIZE = 25

function DatasetsListPage() {
  const [query, setQuery] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [sortBy, setSortBy] = useState<SortKey>("updatedAt")
  const [order, setOrder] = useState<"asc" | "desc">("desc")
  const canAnnotate = useHasPermission("models:annotate")

  const datasetsQuery = useDatasets({
    limit: size,
    offset: (page - 1) * size,
    order,
    sort: sortBy,
  })
  const data = datasetsQuery.data ?? null
  const isLoading = datasetsQuery.isPending
  const error = data || !datasetsQuery.error ? null : xgMessage(datasetsQuery.error)
  const invalidate = useInvalidateModels()

  useEffect(() => {
    if (datasetsQuery.error && !datasetsQuery.data) toast.error(xgMessage(datasetsQuery.error))
  }, [datasetsQuery.error, datasetsQuery.data])

  const q = query.trim().toLowerCase()
  const datasets = data?.datasets ?? []
  const visible = q
    ? datasets.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.slug.includes(q) ||
          (d.description ?? "").toLowerCase().includes(q) ||
          d.classes.some((c) => c.name.toLowerCase().includes(q)),
      )
    : datasets

  const onToggleSort = (columnId: string) => {
    const key = columnId as SortKey
    if (key === sortBy) setOrder((o) => (o === "asc" ? "desc" : "asc"))
    else {
      setSortBy(key)
      setOrder(key === "name" ? "asc" : "desc")
    }
    setPage(1)
  }

  const columns: DataTableColumn<DatasetSummary>[] = [
    {
      id: "name",
      header: "Name",
      sortable: true,
      cell: (d) => (
        <Link to="/datasets/$id" params={{ id: d.id }} className="block leading-tight">
          <span className="block text-sm font-medium text-foreground hover:underline">{d.name}</span>
          {d.description ? (
            <span className="block max-w-md truncate text-xs text-muted-foreground">{d.description}</span>
          ) : null}
        </Link>
      ),
      csvValue: (d) => d.name,
    },
    {
      id: "classes",
      header: "Classes",
      cell: (d) => (
        <span className="flex flex-wrap gap-1">
          {d.classes.slice(0, 6).map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px]"
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: c.color }} />
              {c.name}
            </span>
          ))}
          {d.classes.length > 6 ? (
            <span className="text-[11px] text-muted-foreground">+{d.classes.length - 6}</span>
          ) : null}
        </span>
      ),
      csvValue: (d) => d.classes.map((c) => c.name).join(" "),
    },
    {
      id: "items",
      header: "Items",
      numeric: true,
      cell: (d) => d.itemCount,
      csvValue: (d) => d.itemCount,
    },
    {
      id: "labeled",
      header: "Labeled",
      numeric: true,
      cell: (d) => (
        <>
          {d.labeledCount}
          {d.itemCount > 0 ? (
            <span className="ml-1 text-muted-foreground">
              ({Math.round((d.labeledCount / d.itemCount) * 100)}%)
            </span>
          ) : null}
        </>
      ),
      csvValue: (d) => d.labeledCount,
    },
    {
      id: "version",
      header: "Version",
      cellClassName: "tabular-nums",
      cell: (d) =>
        d.latestVersion !== null ? (
          <>
            v{d.latestVersion}
            {d.versionCount > 1 ? (
              <span className="ml-1 text-muted-foreground">({d.versionCount} total)</span>
            ) : null}
          </>
        ) : d.versionCount > 0 ? (
          <span className="text-muted-foreground">building</span>
        ) : (
          <span className="text-muted-foreground">none</span>
        ),
      csvValue: (d) => d.latestVersion ?? "",
    },
    {
      id: "updatedAt",
      header: "Updated",
      sortable: true,
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (d) => `${formatRelative(d.updatedAt)} ago`,
      csvValue: (d) => d.updatedAt,
    },
  ]

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-0 min-w-0 flex-col gap-6 p-4 pt-0 group-has-data-[collapsible=icon]/sidebar-wrapper:h-[calc(100svh-3rem)]">
      <StickyHeader className="border-b border-border pb-4">
        <header className="flex flex-wrap items-start gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Datasets</h1>
            <p className="text-sm text-muted-foreground">
              Frames from your devices, labeled by your team, versioned for training.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {canAnnotate ? (
              <Button variant="brand" size="lg" onClick={() => setCreateOpen(true)} data-testid="new-dataset">
                <PlusIcon />
                New dataset
              </Button>
            ) : null}
          </div>
        </header>
      </StickyHeader>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <DataTable
          fillHeight
          className="min-h-0 flex-1"
          columns={columns}
          rows={visible}
          getRowKey={(d) => d.id}
          loading={isLoading}
          isFiltered={q !== ""}
          sort={{ columnId: sortBy, dir: order }}
          onToggleSort={onToggleSort}
          toolbar={
            <DataTableToolbar
              search={{ value: query, onChange: setQuery, placeholder: "Filter by name, description or class…" }}
              searchAlign="right"
            />
          }
          pagination={{
            page,
            pageSize: size,
            total: data?.total ?? 0,
            rowsOnPage: visible.length,
            pageSizes: PAGE_SIZES,
            onPageChange: setPage,
            onPageSizeChange: (s) => {
              setSize(s)
              setPage(1)
            },
          }}
          exportCsv={{ filename: "datasets.csv" }}
          empty={
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <p className="text-sm font-medium">No datasets yet</p>
              <p className="text-xs text-muted-foreground">
                Create one, add frames from a recording or an upload, and start labeling.
              </p>
              {canAnnotate ? (
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="text-xs text-primary underline-offset-2 hover:underline"
                >
                  New dataset
                </button>
              ) : null}
            </div>
          }
          filteredEmpty={
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <p className="text-sm text-muted-foreground">No datasets match the filter.</p>
              <button type="button" onClick={() => setQuery("")} className="text-xs text-primary underline-offset-2 hover:underline">
                Clear filter
              </button>
            </div>
          }
        />
      )}

      <CreateDatasetDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) invalidate.datasets()
        }}
      />
    </div>
  )
}
