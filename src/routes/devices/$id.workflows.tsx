import { useCallback, useEffect, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  useDeviceAttachments,
  useDeviceAttachmentsCache,
  useDeviceWorkflowRuns,
} from "@/queries/workflows"
import { requireWorkspace } from "@/lib/auth-guard"
import { toast } from "sonner"
import {
  MoreHorizontalIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  DataTable,
  DataTableToolbar,
  DateRangeFilter,
  formatDuration,
  type DataTableColumn,
  type DateRangeValue,
} from "@/components/data-table"
import { RunStatusCell } from "@/components/run-status"
import { formatRelative } from "@/lib/relative-time"
import { detachWorkflow, listDeviceRuns } from "@/lib/device-workflows-api"
import {
  triggerSummary,
  type DeviceWorkflowAttachment,
} from "@/lib/device-workflow-schemas"
import {
  listWorkflowRunsResponseSchema,
  type WorkflowRunSummary,
} from "@/lib/workflow-run-schemas"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import {
  AttachmentsEmptyState,
  AttachmentStatusCell,
  AttachmentTriggerBadge,
  AttachmentVersionCell,
} from "./-components/attachments-table-parts"
import { AttachWorkflowSheet } from "./-components/attach-workflow-sheet"
import { RunNowDialog } from "./-components/run-now-dialog"

const RUNS_PAGE_SIZES = [25, 50, 100]
const RUNS_DEFAULT_SIZE = 25

// The two lists are sub-tabs rather than stacked sections so each one can own
// the full tab height. Local state, not the URL: unlike the device tabs above,
// there's nothing here worth linking to.
//
// Runs lead (and default), matching the device tab bar's observation-before-
// configuration order: workflows get attached once and watched many times. A
// fresh device lands on an empty runs list, but "Attach workflow" is pinned to
// the tab bar on both sub-tabs, so the next action is still in reach.
type SubTab = "attached" | "runs"

export const Route = createFileRoute("/devices/$id/workflows")({
  beforeLoad: requireWorkspace,
  component: DeviceWorkflowsPage,
})

function DeviceWorkflowsPage() {
  const { id } = Route.useParams()
  const [subTab, setSubTab] = useState<SubTab>("runs")
  const [attachOpen, setAttachOpen] = useState(false)
  const [runTarget, setRunTarget] = useState<DeviceWorkflowAttachment | null>(
    null
  )
  const deviceName = useBreadcrumbStore((s) => s.deviceName)

  // Recent runs: server-side sort (by start time), pagination, and date filter;
  // client-side search over the loaded page.
  const [runsPage, setRunsPage] = useState(1)
  const [runsSize, setRunsSize] = useState(RUNS_DEFAULT_SIZE)
  const [runsOrder, setRunsOrder] = useState<"asc" | "desc">("desc")
  const [runsRange, setRunsRange] = useState<DateRangeValue>({ mode: "all" })
  const [runsQuery, setRunsQuery] = useState("")

  const runsFrom = runsRange.mode === "all" ? undefined : runsRange.from
  const runsTo = runsRange.mode === "all" ? undefined : runsRange.to

  // Attachments: a small per-device config list, cached so a tab switch
  // renders it instantly. Writes edit the cached list in place below.
  const attachmentsQuery = useDeviceAttachments(id)
  // On a failed load fall back to an empty table (with the toast below), as
  // the old inline load did, rather than a skeleton that never resolves.
  const attachments =
    attachmentsQuery.data ?? (attachmentsQuery.isError ? [] : null)
  const attachmentsCache = useDeviceAttachmentsCache(id)

  // Runs: filter changes are new query keys; the held page stays on screen
  // while the next one loads instead of flashing the loading table.
  const runsDataQuery = useDeviceWorkflowRuns(id, {
    limit: runsSize,
    offset: (runsPage - 1) * runsSize,
    order: runsOrder,
    from: runsFrom,
    to: runsTo,
  })
  const runsData =
    runsDataQuery.data ??
    (runsDataQuery.isError ? { runs: [], total: 0 } : null)

  // Surface load failures once, only when there is nothing to show.
  useEffect(() => {
    if (attachmentsQuery.error && !attachmentsQuery.data) {
      toast.error((attachmentsQuery.error as Error).message)
    }
  }, [attachmentsQuery.error, attachmentsQuery.data])
  useEffect(() => {
    if (runsDataQuery.error && !runsDataQuery.data) {
      toast.error((runsDataQuery.error as Error).message)
    }
  }, [runsDataQuery.error, runsDataQuery.data])

  const replaceAttachment = attachmentsCache.replace

  const handleDetach = useCallback(
    async (attachment: DeviceWorkflowAttachment) => {
      try {
        await detachWorkflow(id, attachment.id)
        attachmentsCache.remove(attachment.id)
        toast.success(`Detached "${attachment.templateName}"`)
      } catch (err) {
        toast.error((err as Error).message)
      }
    },
    [id, attachmentsCache]
  )

  const attachmentColumns: DataTableColumn<DeviceWorkflowAttachment>[] = [
    {
      id: "workflow",
      header: "Workflow",
      cell: (a) => (
        <Link
          to="/workflow-templates/$id"
          params={{ id: a.templateId }}
          className="block leading-tight"
        >
          <span className="block text-sm font-medium text-foreground hover:underline">
            {a.templateName}
          </span>
          <span className="block text-xs text-muted-foreground">
            {a.templateSlug}
          </span>
        </Link>
      ),
    },
    {
      id: "version",
      header: "Version",
      cell: (a) => (
        <AttachmentVersionCell
          pinnedVersion={a.pinnedVersion}
          runningVersion={a.runningVersion}
        />
      ),
    },
    {
      id: "trigger",
      header: "Trigger",
      cellClassName: "leading-tight",
      cell: (a) => (
        <div className="flex flex-col gap-1.5">
          {a.triggers.map((t, i) => (
            <div key={i}>
              <AttachmentTriggerBadge type={t.type} />
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {triggerSummary(t)}
              </span>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: "state",
      header: "State",
      cell: (a) => <AttachmentStatusCell enabled={a.enabled} />,
    },
    {
      id: "lastRun",
      header: "Last run",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (a) =>
        a.lastRunAt ? (
          <span className="inline-flex items-center gap-1.5">
            {a.lastRunStatus ? (
              <RunStatusCell status={a.lastRunStatus} />
            ) : null}
            <span>{formatRelative(a.lastRunAt)} ago</span>
          </span>
        ) : (
          "never"
        ),
    },
    {
      id: "runs",
      header: "Runs",
      numeric: true,
      cellClassName: "text-muted-foreground",
      cell: (a) => (a.runCount > 0 ? a.runCount : "—"),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (a) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setRunTarget(a)}>
              <PlayIcon />
              Run now
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => handleDetach(a)}
            >
              <Trash2Icon />
              Detach
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  const runColumns: DataTableColumn<WorkflowRunSummary>[] = [
    {
      id: "workflow",
      header: "Workflow",
      cellClassName: "leading-tight",
      cell: (run) => (
        <>
          <Link
            to="/workflow-instances/$id"
            params={{ id: run.id }}
            className="block text-sm font-medium text-foreground hover:underline"
          >
            {run.templateName}
          </Link>
          <span className="block text-xs text-muted-foreground">
            v{run.templateVersion}
          </span>
        </>
      ),
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

  // Client-side workflow-name search over the current runs page.
  const runsQ = runsQuery.trim().toLowerCase()
  const visibleRuns = runsQ
    ? (runsData?.runs ?? []).filter((r) =>
        r.templateName.toLowerCase().includes(runsQ)
      )
    : (runsData?.runs ?? [])
  const runsFiltered = runsQ !== "" || runsRange.mode !== "all"

  // Fetch every run matching the current date filter (paged), then apply the
  // client search — the table's standard Export CSV calls this.
  const getRunsExportRows = async (): Promise<WorkflowRunSummary[]> => {
    const pageLimit = 200
    const all: WorkflowRunSummary[] = []
    let off = 0
    let grandTotal = Infinity
    while (off < grandTotal && all.length < 5000) {
      const raw = await listDeviceRuns(id, {
        limit: pageLimit,
        offset: off,
        order: runsOrder,
        from: runsFrom,
        to: runsTo,
      })
      const parsed = listWorkflowRunsResponseSchema.safeParse(raw)
      if (!parsed.success) break
      all.push(...parsed.data.runs)
      grandTotal = parsed.data.page?.total ?? parsed.data.runs.length
      if (parsed.data.runs.length === 0) break
      off += pageLimit
    }
    return runsQ
      ? all.filter((r) => r.templateName.toLowerCase().includes(runsQ))
      : all
  }

  return (
    // min-h-0/flex-1 chain: the active sub-tab's table owns the leftover height
    // and scrolls its own rows, so the page itself never grows.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <Tabs
        value={subTab}
        onValueChange={(v) => setSubTab(v as SubTab)}
        className="min-h-0 flex-1 gap-4"
      >
        {/* Segmented (default) variant, deliberately NOT `line`: the device tab
            bar directly above is a line tab bar, and a second underlined row
            under it reads as one confused hierarchy. The filled pill says
            "nested control" instead. "Attach workflow" is the tab's primary
            action, not the attached list's, so it stays put on both sub-tabs —
            and sitting here keeps it out of the table's scroll area. */}
        <div className="flex shrink-0 items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="runs">Recent runs</TabsTrigger>
            <TabsTrigger value="attached">Attached workflows</TabsTrigger>
          </TabsList>
          <Button size="sm" onClick={() => setAttachOpen(true)}>
            <PlusIcon />
            Attach workflow
          </Button>
        </div>

        <TabsContent value="runs" className="flex min-h-0 flex-col">
          <DataTable
            card
            fillHeight
            columns={runColumns}
            rows={visibleRuns}
            getRowKey={(run) => run.id}
            loading={runsData === null}
            isFiltered={runsFiltered}
            sort={{ columnId: "startedAt", dir: runsOrder }}
            onToggleSort={() => {
              setRunsOrder((o) => (o === "asc" ? "desc" : "asc"))
              setRunsPage(1)
            }}
            toolbar={
              <DataTableToolbar
                filters={
                  <DateRangeFilter
                    value={runsRange}
                    onChange={(v) => {
                      setRunsRange(v)
                      setRunsPage(1)
                    }}
                  />
                }
                search={{
                  value: runsQuery,
                  onChange: setRunsQuery,
                  placeholder: "Filter by workflow…",
                }}
                searchAlign="right"
              />
            }
            empty={
              <p className="py-8 text-center text-sm text-muted-foreground">
                No workflow runs on this device yet.
              </p>
            }
            filteredEmpty={
              <p className="py-8 text-center text-sm text-muted-foreground">
                No workflow runs match these filters.
              </p>
            }
            pagination={{
              page: runsPage,
              pageSize: runsSize,
              total: runsData?.total ?? 0,
              rowsOnPage: visibleRuns.length,
              pageSizes: RUNS_PAGE_SIZES,
              onPageChange: setRunsPage,
              onPageSizeChange: (s) => {
                setRunsSize(s)
                setRunsPage(1)
              },
            }}
            exportCsv={{
              filename: `workflow-runs-${id}.csv`,
              getRows: getRunsExportRows,
            }}
          />
        </TabsContent>

        <TabsContent value="attached" className="flex min-h-0 flex-col">
          <DataTable
            card
            fillHeight
            columns={attachmentColumns}
            rows={attachments ?? []}
            getRowKey={(a) => a.id}
            loading={attachments === null}
            skeletonRows={3}
            empty={
              <AttachmentsEmptyState onAttach={() => setAttachOpen(true)} />
            }
          />
        </TabsContent>
      </Tabs>

      <AttachWorkflowSheet
        deviceId={id}
        deviceName={deviceName}
        attachedTemplateIds={attachments?.map((a) => a.templateId) ?? []}
        open={attachOpen}
        onOpenChange={setAttachOpen}
        onAttached={attachmentsCache.prepend}
      />

      <RunNowDialog
        deviceId={id}
        attachment={runTarget}
        open={runTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRunTarget(null)
        }}
        onRan={replaceAttachment}
      />
    </div>
  )
}
