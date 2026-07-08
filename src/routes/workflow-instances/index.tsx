import { useEffect, useMemo, useState } from "react"
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

interface RunsData {
  workspaceId: string | null
  runs: WorkflowRunSummary[]
}

function WorkflowInstancesListPage() {
  const [data, setData] = useState<RunsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<RunStatus | "any">("any")
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)

  // Re-fetch when the active workspace changes (same pattern as the devices list).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const raw = await listWorkflowInstances()
        const parsed = listWorkflowRunsResponseSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error("Unexpected /workflow-runs response shape")
        }
        if (cancelled) return
        setError(null)
        setData({ workspaceId: currentWorkspaceId, runs: parsed.data.runs })
      } catch (err) {
        const message = (err as Error).message
        if (cancelled) return
        setError(message)
        setData({ workspaceId: currentWorkspaceId, runs: [] })
        toast.error(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [currentWorkspaceId])

  const isLoading = !data || data.workspaceId !== currentWorkspaceId
  const runs = isLoading ? null : data.runs

  const filtered = useMemo(() => {
    if (!runs) return []
    const q = query.trim().toLowerCase()
    return runs.filter((r) => {
      if (statusFilter !== "any" && r.status !== statusFilter) return false
      if (!q) return true
      return (
        r.templateName.toLowerCase().includes(q) ||
        r.deviceName.toLowerCase().includes(q)
      )
    })
  }, [runs, query, statusFilter])

  const clearFilters = () => {
    setQuery("")
    setStatusFilter("any")
  }
  const isFiltered = query.trim() !== "" || statusFilter !== "any"

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
          {run.deviceName}
        </Link>
      ),
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
    },
    {
      id: "trigger",
      header: "Trigger",
      cellClassName: "text-muted-foreground",
      cell: (run) => run.trigger,
    },
    {
      id: "status",
      header: "Status",
      cell: (run) => <RunStatusCell status={run.status} />,
    },
    {
      id: "startedAt",
      header: "Started",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (run) => `${formatRelative(run.startedAt)} ago`,
    },
    {
      id: "duration",
      header: "Duration",
      numeric: true,
      cellClassName: "text-muted-foreground",
      cell: (run) => formatDuration(run.durationMs),
    },
    {
      id: "events",
      header: "Events",
      numeric: true,
      cellClassName: "text-muted-foreground",
      cell: (run) => (run.eventCount > 0 ? run.eventCount : "—"),
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
          <DropdownMenuItem key={opt} onSelect={() => setStatusFilter(opt)}>
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
          rows={filtered}
          getRowKey={(run) => run.id}
          loading={isLoading}
          isFiltered={isFiltered}
          toolbar={
            <DataTableToolbar
              search={{
                value: query,
                onChange: setQuery,
                placeholder: "Filter by template or device…",
              }}
              filters={statusFilterMenu}
              right={runs ? `Showing ${filtered.length} of ${runs.length}` : null}
            />
          }
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
