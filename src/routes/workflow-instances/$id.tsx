import { useEffect, useState } from "react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { toast } from "sonner"
import { AlertTriangleIcon, RotateCwIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  getWorkflowInstance,
  rerunWorkflowInstance,
} from "@/lib/workflow-instances-api"
import {
  getWorkflowRunResponseSchema,
  type RunStatus,
  type WorkflowRunDetail,
} from "@/lib/workflow-run-schemas"
import { useAuthStore } from "@/store/auth"
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
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
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
  const [run, setRun] = useState<WorkflowRunDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [busy, setBusy] = useState(false)
  // RunGraph reuses the editor's node card, whose handles are typed from the
  // served catalog; the run graph edges carry those port ids. Load the catalog
  // and gate the graph on it so edges bind on first paint (RunGraph is
  // uncontrolled and can't resync after mount).
  const catalogStatus = useWorkflowCatalog((s) => s.status)

  useEffect(() => {
    void useWorkflowCatalog.getState().ensureLoaded()
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const raw = await getWorkflowInstance(id)
        const parsed = getWorkflowRunResponseSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error("Unexpected /workflow-runs/:id response shape")
        }
        if (cancelled) return
        const fetched = parsed.data.run
        setRun(fetched)
        useBreadcrumbStore
          .getState()
          .setInstanceName(
            `${fetched.templateName} · ${fetched.deviceName ?? "simulation"}`,
          )
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          if (!cancelled) setNotFound(true)
          return
        }
        const message = (err as Error).message
        if (!cancelled) setError(message)
        toast.error(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

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
          <RunTrace steps={run.steps} />
        </div>
      </Section>

      <Section title="Events produced">
        <RunEvents events={run.events} />
      </Section>

      <Section title="Run record">
        <RunRawJson data={run} />
      </Section>
    </div>
  )
}
