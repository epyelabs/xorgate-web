import { useEffect, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { requireWorkspace } from "@/lib/auth-guard"
import { toast } from "sonner"
import { AlertTriangleIcon, RadioIcon, RotateCwIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { isXorgateError } from "@xorgate/sdk"
import { xgMessage } from "@/lib/xorgate"
import { cn } from "@/lib/utils"
import { rerunWorkflowInstance } from "@/lib/workflow-instances-api"
import { type RunStatus } from "@/lib/workflow-run-schemas"
import { useWorkflowInstance } from "@/queries/workflows"
import { useSimProgress } from "@/hooks/use-sim-progress"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import { useWorkflowCatalog } from "@/store/workflow-catalog"
import { StickyHeader } from "@/components/sticky-header"
import { RunEvents } from "./-components/run-events"
import { RunGraph } from "./-components/run-graph"
import { RunMetrics } from "./-components/run-metrics"
import { RunRawJson } from "./-components/run-raw-json"
import { RunTrace } from "./-components/run-trace"
import { formatDuration } from "@/components/data-table"

export const Route = createFileRoute("/workflow-instances/$id")({
  beforeLoad: requireWorkspace,
  component: WorkflowInstanceDetailPage,
})

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—"
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? iso : dateTimeFormat.format(parsed)
}

function statusVariant(status: RunStatus): "secondary" | "destructive" {
  return status === "failed" ? "destructive" : "secondary"
}

function statusColor(status: RunStatus): string {
  if (status === "succeeded") return "text-emerald-600"
  if (status === "running") return "text-sky-600"
  return ""
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}

function WorkflowInstanceDetailPage() {
  const { id } = Route.useParams()
  const [busy, setBusy] = useState(false)
  // RunGraph reuses the editor's node card, whose handles are typed from the
  // served catalog; the run graph edges carry those port ids. Load the catalog
  // and gate the graph on it so edges bind on first paint (RunGraph is
  // uncontrolled and can't resync after mount).
  const catalogStatus = useWorkflowCatalog((s) => s.status)

  useEffect(() => {
    void useWorkflowCatalog.getState().ensureLoaded()
  }, [])

  // The run row. The query polls itself at 2.5s exactly while the row says
  // "running" (the refetchInterval reads its own data) and a transient poll
  // failure keeps the last good detail on screen — the old silent-poll
  // plumbing, handled by the cache.
  const runQuery = useWorkflowInstance(id)
  const run = runQuery.data ?? null
  const notFound =
    isXorgateError(runQuery.error) && runQuery.error.status === 404
  const error =
    run || !runQuery.error || notFound ? null : xgMessage(runQuery.error)

  useEffect(() => {
    if (error) toast.error(error)
  }, [error])

  useEffect(() => {
    if (run) {
      useBreadcrumbStore
        .getState()
        .setInstanceName(
          `${run.templateName} · ${run.deviceName ?? "simulation"}`,
        )
    }
  }, [run])

  // Live updates while the run executes (M6): subscribe to the run's progress
  // topics (wf/run/... for production, wf/sim/... for simulations); the poll
  // above stays the authoritative terminal state (QoS 0 topics are the live
  // view only; a sub-second Lambda run can outrace the subscription).
  const running = run?.status === "running"
  const live = useSimProgress(running ? (run?.progress?.topicPrefix ?? null) : null)

  // The status topic usually beats the poll to the terminal flip; refetch
  // immediately so steps/events/artifacts (written by finalize) appear fast.
  const liveTerminal = live.status !== null && live.status.status !== "running"
  const { refetch: refetchRun } = runQuery
  useEffect(() => {
    if (!running || !liveTerminal) return
    void refetchRun()
  }, [running, liveTerminal, refetchRun])

  useEffect(() => {
    return () => {
      useBreadcrumbStore.getState().setInstanceName(null)
    }
  }, [id])

  const handleRerun = async () => {
    if (!run) return
    setBusy(true)
    try {
      await rerunWorkflowInstance(run.id)
      toast.success("Re-run queued")
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (notFound) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <p className="text-sm text-muted-foreground">Workflow instance not found.</p>
      </div>
    )
  }

  if (error && !run) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  if (!run) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4 pt-0">
        <Skeleton className="h-12 w-full max-w-2xl" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    )
  }

  const failedStep = run.steps.find((s) => s.status === "failed")

  // While the run executes, the DB has no step/event rows yet (the v2 engine
  // persists them at finalize) — render the live topic view; once the row
  // carries persisted rows they win (identical content, finalize-authoritative).
  const displaySteps =
    run.steps.length > 0
      ? run.steps
      : live.steps.map((s) => ({
          nodeId: s.nodeId,
          label: s.label,
          status: s.status,
          output: s.output,
          durationMs: s.durationMs,
        }))
  const displayEvents =
    run.events.length > 0
      ? run.events
      : live.events.map((e, i) => ({
          id: `live-${i}`,
          kind: e.kind,
          occurredAt: e.occurredAt,
          confidence: e.confidence,
          clip: false,
          payloadSummary: e.payloadSummary,
        }))

  return (
    <div className="flex flex-1 flex-col gap-5 p-4 pt-0">
      {/* Overview & status */}
      <StickyHeader className="border-b border-border pb-4">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={statusVariant(run.status)}
              className={cn(statusColor(run.status))}
            >
              {run.status}
            </Badge>
            <Link
              to="/workflow-templates/$id"
              params={{ id: run.templateId }}
              className="text-xl font-semibold tracking-tight hover:underline"
            >
              {run.templateName}
            </Link>
            <span className="text-sm text-muted-foreground">
              v{run.templateVersion}
            </span>
            {running && live.connection === "connected" ? (
              <Badge variant="outline" className="gap-1 text-sky-600">
                <RadioIcon className="size-3" />
                live
              </Badge>
            ) : null}
            <div className="ml-auto">
              {/* Simulation runs re-run from the editor's simulator (the
                  backend returns 400 for them). */}
              {run.mode !== "simulation" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRerun}
                  disabled={busy}
                >
                  <RotateCwIcon />
                  Re-run
                </Button>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {run.mode === "simulation" ? (
              <>
                <Badge variant="outline">simulation</Badge>
                <span>·</span>
              </>
            ) : null}
            <span>
              Device{" "}
              <span className="font-medium text-foreground">
                {run.deviceName ?? "—"}
              </span>
            </span>
            <span>·</span>
            <span>Workspace {run.workspaceName ?? "—"}</span>
            <span>·</span>
            <span>trigger: {run.trigger}</span>
            <span>·</span>
            <span>started {formatTimestamp(run.startedAt)}</span>
            <span>·</span>
            <span>ended {formatTimestamp(run.endedAt)}</span>
            <span>·</span>
            <span>{formatDuration(run.durationMs)}</span>
            <span>·</span>
            <span>
              triggered by{" "}
              <span className="text-foreground">{run.triggeredBy}</span>
            </span>
          </div>
        </header>
      </StickyHeader>

      {/* Error band (failed runs only) */}
      {run.status === "failed" && run.error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <p className="font-medium">{run.error}</p>
            {failedStep ? (
              <p className="text-destructive/80">
                Failed at node: {failedStep.label}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <Section title="Metrics">
        <RunMetrics metrics={run.metrics} />
      </Section>

      <Section title="Pipeline trace">
        <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
          <div className="h-[360px] overflow-hidden rounded-lg border border-border">
            {catalogStatus === "idle" || catalogStatus === "loading" ? (
              <Skeleton className="h-full w-full" />
            ) : (
              // Key on the catalog status too so a late-arriving catalog re-seeds
              // the uncontrolled defaults and binds the typed edges.
              <RunGraph
                key={`${run.id}:${catalogStatus}`}
                definition={run.definition}
                failedNodeId={run.failedNodeId}
              />
            )}
          </div>
          <RunTrace steps={displaySteps} />
        </div>
      </Section>

      <Section title="Events produced">
        <RunEvents
          events={displayEvents}
          mode={run.mode}
          definition={run.definition}
        />
      </Section>

      <Section title="Run record">
        <RunRawJson data={run} />
      </Section>
    </div>
  )
}
