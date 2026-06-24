import { useEffect, useMemo, useState } from "react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { toast } from "sonner"
import { ChevronDownIcon, FilterIcon, SearchIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatRelative } from "@/lib/relative-time"
import { listWorkflowInstances } from "@/lib/workflow-instances-api"
import {
  listWorkflowRunsResponseSchema,
  type RunStatus,
  type WorkflowRunSummary,
} from "@/lib/workflow-run-schemas"
import { useAuthStore } from "@/store/auth"
import { useWorkspaceStore } from "@/store/workspace"
import {
  ColHead,
  EmptyState,
  FilteredEmptyState,
  formatDuration,
  RunsTableSkeleton,
  RunStatusCell,
} from "./-components/runs-table-parts"

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
  projectId: string | null
  runs: WorkflowRunSummary[]
}

function WorkflowInstancesListPage() {
  const [data, setData] = useState<RunsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<RunStatus | "any">("any")
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId)

  // Re-fetch when the active project changes (same pattern as the devices list).
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
        setData({ projectId: currentProjectId, runs: parsed.data.runs })
      } catch (err) {
        const message = (err as Error).message
        if (cancelled) return
        setError(message)
        setData({ projectId: currentProjectId, runs: [] })
        toast.error(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [currentProjectId])

  const isLoading = !data || data.projectId !== currentProjectId
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

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <header className="flex flex-wrap items-start gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Workflow Instances
          </h1>
          <p className="text-sm text-muted-foreground">
            Workflow runs in this project, triggered by workflows attached to
            devices.
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by template or device…"
              className="pl-7"
            />
          </div>
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
          {runs ? (
            <span className="ml-auto text-xs text-muted-foreground">
              Showing {filtered.length} of {runs.length}
            </span>
          ) : null}
        </div>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : isLoading ? (
          <RunsTableSkeleton />
        ) : runs && runs.length === 0 ? (
          <EmptyState />
        ) : filtered.length === 0 ? (
          <FilteredEmptyState onClear={clearFilters} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <ColHead>Device</ColHead>
                <ColHead>Template</ColHead>
                <ColHead>Trigger</ColHead>
                <ColHead>Status</ColHead>
                <ColHead>Started</ColHead>
                <ColHead>Duration</ColHead>
                <ColHead>Events</ColHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link
                      to="/workflow-instances/$id"
                      params={{ id: run.id }}
                      className="text-sm font-medium text-foreground tabular-nums hover:underline"
                    >
                      {run.deviceName}
                    </Link>
                  </TableCell>
                  <TableCell className="leading-tight">
                    <span className="block text-sm">{run.templateName}</span>
                    <span className="block text-xs text-muted-foreground">
                      v{run.templateVersion}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {run.trigger}
                  </TableCell>
                  <TableCell>
                    <RunStatusCell status={run.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {formatRelative(run.startedAt)} ago
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {formatDuration(run.durationMs)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {run.eventCount > 0 ? run.eventCount : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
