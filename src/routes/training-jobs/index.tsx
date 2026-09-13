import { useEffect, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
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
  StatusDot,
  type DataTableColumn,
} from "@/components/data-table"
import { StickyHeader } from "@/components/sticky-header"
import { formatRelative } from "@/lib/relative-time"
import { xgMessage } from "@/lib/xorgate"
import {
  formatMetric,
  formatSeconds,
  JOB_STATUS_COLOR,
  jobPhase,
  jobTitle,
  jobWallSeconds,
  shortId,
} from "@/lib/models-format"
import {
  TRAINING_STATUSES,
  TRAINING_TASKS,
  type TrainingJob,
  type TrainingStatus,
  type TrainingTask,
} from "@/lib/models-schemas"
import { useTrainingJobs } from "@/queries/models"

export const Route = createFileRoute("/training-jobs/")({
  beforeLoad: requireAuth,
  component: TrainingJobsListPage,
})

type SortKey = "createdAt" | "updatedAt"
const PAGE_SIZES = [25, 50, 100]
const DEFAULT_SIZE = 25

// The list of training and assist jobs, org-wide. A job is started from a
// dataset version (Train) or a dataset (Assist), never from here: this page is
// where you watch them, and the row polls itself while anything is in flight.
function TrainingJobsListPage() {
  const [statusFilter, setStatusFilter] = useState<TrainingStatus | "any">("any")
  const [taskFilter, setTaskFilter] = useState<TrainingTask | "any">("any")
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [sortBy, setSortBy] = useState<SortKey>("createdAt")
  const [order, setOrder] = useState<"asc" | "desc">("desc")

  const jobsQuery = useTrainingJobs({
    limit: size,
    offset: (page - 1) * size,
    order,
    sort: sortBy,
    status: statusFilter === "any" ? undefined : statusFilter,
    task: taskFilter === "any" ? undefined : taskFilter,
  })
  const data = jobsQuery.data ?? null
  const error = data || !jobsQuery.error ? null : xgMessage(jobsQuery.error)
  useEffect(() => {
    if (jobsQuery.error && !jobsQuery.data) toast.error(xgMessage(jobsQuery.error))
  }, [jobsQuery.error, jobsQuery.data])

  const onToggleSort = (columnId: string) => {
    const key = columnId as SortKey
    if (key === sortBy) setOrder((o) => (o === "asc" ? "desc" : "asc"))
    else {
      setSortBy(key)
      setOrder("desc")
    }
    setPage(1)
  }

  const columns: DataTableColumn<TrainingJob>[] = [
    {
      id: "job",
      header: "Job",
      cell: (job) => (
        <Link to="/training-jobs/$id" params={{ id: job.id }} className="block leading-tight">
          <span className="block text-sm font-medium text-foreground hover:underline">{jobTitle(job)}</span>
          <span className="block font-mono text-[11px] text-muted-foreground">
            {shortId(job.id)}
            {job.output?.label ? ` · ${job.output.label}` : ""}
          </span>
        </Link>
      ),
      csvValue: (job) => jobTitle(job),
    },
    {
      id: "status",
      header: "Status",
      cell: (job) => {
        const phase = jobPhase(job)
        return (
          <span className="inline-flex items-center gap-1.5">
            <StatusDot color={JOB_STATUS_COLOR[job.status]} label={job.status} />
            {phase ? <span className="text-[11px] text-muted-foreground">{phase}</span> : null}
          </span>
        )
      },
      csvValue: (job) => job.status,
    },
    {
      id: "task",
      header: "Task",
      cell: (job) => job.task,
      csvValue: (job) => job.task,
    },
    {
      id: "target",
      header: "Target",
      cell: (job) => (
        <span className="text-xs">
          {job.target}
          <span className="ml-1 font-mono text-[11px] text-muted-foreground">
            {job.compute?.instanceType ?? ""}
            {job.compute?.spot ? " spot" : ""}
          </span>
        </span>
      ),
      csvValue: (job) => job.compute?.instanceType ?? job.target,
    },
    {
      id: "map50",
      header: "mAP50",
      numeric: true,
      cell: (job) => (job.task === "train" ? formatMetric(job.metrics?.mAP50) : "—"),
      csvValue: (job) => job.metrics?.mAP50 ?? "",
    },
    {
      id: "wall",
      header: "Wall / billable",
      numeric: true,
      cell: (job) => (
        <span className="text-xs">
          {formatSeconds(jobWallSeconds(job))}
          <span className="ml-1 text-muted-foreground">/ {formatSeconds(job.billableSeconds)}</span>
        </span>
      ),
      csvHeader: "Billable seconds",
      csvValue: (job) => job.billableSeconds ?? "",
    },
    {
      id: "createdAt",
      header: "Started",
      sortable: true,
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (job) => `${formatRelative(job.createdAt)} ago`,
      csvValue: (job) => job.createdAt,
    },
  ]

  const isFiltered = statusFilter !== "any" || taskFilter !== "any"

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-0 min-w-0 flex-col gap-6 p-4 pt-0 group-has-data-[collapsible=icon]/sidebar-wrapper:h-[calc(100svh-3rem)]">
      <StickyHeader className="border-b border-border pb-4">
        <header className="flex flex-wrap items-start gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Training</h1>
            <p className="text-sm text-muted-foreground">
              Training and assist jobs. Start one from a dataset version (Train) or a
              dataset (Assist); one job runs per organization at a time.
            </p>
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
          rows={data?.jobs ?? []}
          getRowKey={(job) => job.id}
          loading={jobsQuery.isPending}
          isFiltered={isFiltered}
          sort={{ columnId: sortBy, dir: order }}
          onToggleSort={onToggleSort}
          toolbar={
            <DataTableToolbar
              filters={
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        <FilterIcon />
                        status: {statusFilter}
                        <ChevronDownIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {(["any", ...TRAINING_STATUSES] as const).map((opt) => (
                        <DropdownMenuItem
                          key={opt}
                          onSelect={() => {
                            setStatusFilter(opt)
                            setPage(1)
                          }}
                        >
                          {opt}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        <FilterIcon />
                        task: {taskFilter}
                        <ChevronDownIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {(["any", ...TRAINING_TASKS] as const).map((opt) => (
                        <DropdownMenuItem
                          key={opt}
                          onSelect={() => {
                            setTaskFilter(opt)
                            setPage(1)
                          }}
                        >
                          {opt}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              }
            />
          }
          pagination={{
            page,
            pageSize: size,
            total: data?.total ?? 0,
            pageSizes: PAGE_SIZES,
            onPageChange: setPage,
            onPageSizeChange: (s) => {
              setSize(s)
              setPage(1)
            },
          }}
          exportCsv={{ filename: "training-jobs.csv" }}
          empty={
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <p className="text-sm font-medium">No jobs yet</p>
              <p className="text-xs text-muted-foreground">
                Build a version of a dataset and press Train, or run Assist on a dataset to pre-label it.
              </p>
              <Link to="/datasets" className="text-xs text-primary underline-offset-2 hover:underline">
                Go to datasets
              </Link>
            </div>
          }
          filteredEmpty={
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <p className="text-sm text-muted-foreground">No jobs match the current filters.</p>
              <button
                type="button"
                onClick={() => {
                  setStatusFilter("any")
                  setTaskFilter("any")
                  setPage(1)
                }}
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
