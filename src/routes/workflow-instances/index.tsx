import { useEffect, useState } from "react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { toast } from "sonner"
import { ChevronDownIcon, FilterIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  DataTable,
  DataTableToolbar,
  formatDuration,
  type DataTableColumn,
} from "@/components/data-table"
import { RunStatusCell } from "@/components/run-status"
import { formatRelative } from "@/lib/relative-time"
import { listWorkflowInstances } from "@/lib/workflow-instances-api"
import {
  listWorkflowRunsResponseSchema,
  type RunStatus,
  type WorkflowRunSummary,
} from "@/lib/workflow-run-schemas"
import { useAuthStore } from "@/store/auth"
import { useWorkspaceStore } from "@/store/workspace"
import { StickyHeader } from "@/components/sticky-header"

export const Route = createFileRoute("/workflow-instances/")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: WorkflowInstancesListPage,
})

const STATUS_OPTIONS: readonly (RunStatus | "any")[] = [
  "any",
  "running",
  "succeeded",
  "failed",
]

const PAGE_SIZES = [25, 50, 100]
const DEFAULT_SIZE = 25
const EXPORT_CAP = 5000

interface RunsData {
  workspaceId: string | null
  runs: WorkflowRunSummary[]
  total: number
}

function WorkflowInstancesListPage() {
  const [data, setData] = useState<RunsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<RunStatus | "any">("any")
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [order, setOrder] = useState<"asc" | "desc">("desc")
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)

  const status = statusFilter === "any" ? undefined : statusFilter

  // Reset to the first page when the active workspace changes (adjust-state-
  // during-render; avoids a setState-in-effect cascade).
  const [seenWorkspace, setSeenWorkspace] = useState(currentWorkspaceId)
  if (seenWorkspace !== currentWorkspaceId) {
    setSeenWorkspace(currentWorkspaceId)
    setPage(1)
  }

  // Server-side page/sort/status; the workspace scope comes from the
  // X-Workspace-Id header attached by apiRequest.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const raw = await listWorkflowInstances({
          limit: size,
          offset: (page - 1) * size,
          order,
          status,
        })
        const parsed = listWorkflowRunsResponseSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error("Unexpected /workflow-runs response shape")
        }
        if (cancelled) return
        setError(null)
        setData({
          workspaceId: currentWorkspaceId,
          runs: parsed.data.runs,
          total: parsed.data.page?.total ?? parsed.data.runs.length,
        })
      } catch (err) {
        const message = (err as Error).message
        if (cancelled) return
        setError(message)
        setData({ workspaceId: currentWorkspaceId, runs: [], total: 0 })
        toast.error(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [currentWorkspaceId, page, size, order, status])

  const isLoading = !data || data.workspaceId !== currentWorkspaceId

  // Client-side template/device search over the current page.
  const q = query.trim().toLowerCase()
  const runs = isLoading ? [] : data.runs
  const visible = q
    ? runs.filter(
        (r) =>
          r.templateName.toLowerCase().includes(q) ||
          (r.deviceName ?? "").toLowerCase().includes(q)
      )
    : runs
  const isFiltered = q !== "" || statusFilter !== "any"

  const setStatus = (next: RunStatus | "any") => {
    setStatusFilter(next)
    setPage(1)
  }
  const clearFilters = () => {
    setQuery("")
    setStatusFilter("any")
    setPage(1)
  }

  // Fetch every run matching the current server filters (paged), then apply the
  // client search — the table's standard Export CSV calls this.
  const getExportRows = async (): Promise<WorkflowRunSummary[]> => {
    const pageLimit = 200
    const all: WorkflowRunSummary[] = []
    let off = 0
    let total = Infinity
    while (off < total && all.length < EXPORT_CAP) {
      const raw = await listWorkflowInstances({
        limit: pageLimit,
        offset: off,
        order,
        status,
      })
      const parsed = listWorkflowRunsResponseSchema.safeParse(raw)
      if (!parsed.success) break
      all.push(...parsed.data.runs)
      total = parsed.data.page?.total ?? parsed.data.runs.length
      if (parsed.data.runs.length === 0) break
      off += pageLimit
    }
    return q
      ? all.filter(
          (r) =>
            r.templateName.toLowerCase().includes(q) ||
            (r.deviceName ?? "").toLowerCase().includes(q)
        )
      : all
  }

  const columns: DataTableColumn<WorkflowRunSummary>[] = [
    {
      id: "device",
      header: "Device",
      cell: (run) => (
        <Link
          to="/workflow-instances/$id"
          params={{ id: run.id }}
          className="text-sm font-medium text-foreground tabular-nums hover:underline"
        >
          {run.deviceName ?? "—"}
        </Link>
      ),
      csvValue: (run) => run.deviceName ?? "",
    },
    {
      id: "template",
      header: "Template",
      cellClassName: "leading-tight",
      cell: (run) => (
        <>
          <span className="block text-sm">{run.templateName}</span>
          <span className="block text-xs text-muted-foreground">
            v{run.templateVersion}
          </span>
        </>
      ),
      csvHeader: "Template",
      csvValue: (run) => `${run.templateName} v${run.templateVersion}`,
    },
    {
      id: "trigger",
      header: "Trigger",
      cellClassName: "text-muted-foreground",
      cell: (run) => run.trigger,
      csvValue: (run) => run.trigger,
    },
    {
      id: "status",
      header: "Status",
      cell: (run) => <RunStatusCell status={run.status} />,
      csvValue: (run) => run.status,
    },
    {
      id: "startedAt",
      header: "Started",
      sortable: true,
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (run) => `${formatRelative(run.startedAt)} ago`,
      csvValue: (run) => run.startedAt,
    },
    {
      id: "duration",
      header: "Duration",
      numeric: true,
      cellClassName: "text-muted-foreground",
      cell: (run) => formatDuration(run.durationMs),
      csvHeader: "Duration (ms)",
      csvValue: (run) => run.durationMs ?? "",
    },
    {
      id: "events",
      header: "Events",
      numeric: true,
      cellClassName: "text-muted-foreground",
      cell: (run) => (run.eventCount > 0 ? run.eventCount : "—"),
      csvValue: (run) => run.eventCount,
    },
  ]

  const statusFilterMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <FilterIcon />
          status: {statusFilter}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {STATUS_OPTIONS.map((opt) => (
          <DropdownMenuItem key={opt} onSelect={() => setStatus(opt)}>
            {opt}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <StickyHeader className="border-b border-border pb-4">
        <header className="flex flex-wrap items-start gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Workflow Instances
            </h1>
            <p className="text-sm text-muted-foreground">
              Workflow runs in this workspace, triggered by workflows attached
              to devices.
            </p>
          </div>
        </header>
      </StickyHeader>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <DataTable
          columns={columns}
          rows={visible}
          getRowKey={(run) => run.id}
          loading={isLoading}
          isFiltered={isFiltered}
          sort={{ columnId: "startedAt", dir: order }}
          onToggleSort={() => {
            setOrder((o) => (o === "asc" ? "desc" : "asc"))
            setPage(1)
          }}
          toolbar={
            <DataTableToolbar
              search={{
                value: query,
                onChange: setQuery,
                placeholder: "Filter by template or device…",
              }}
              searchAlign="right"
              filters={statusFilterMenu}
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
          exportCsv={{
            filename: "workflow-instances.csv",
            getRows: getExportRows,
          }}
          empty={
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <p className="text-sm font-medium">No runs in this workspace yet</p>
              <p className="text-xs text-muted-foreground">
                Runs appear here when a workflow attached to a device executes.
              </p>
            </div>
          }
          filteredEmpty={
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                No runs match the current filters.
              </p>
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs text-primary underline-offset-2 hover:underline"
              >
                Clear filters
              </button>
            </div>
          }
        />
      )}
    </div>
  )
}
