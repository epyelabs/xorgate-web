import { AlertTriangleIcon, CheckIcon, XIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { WorkflowRunDetail } from "@/lib/workflow-run-schemas"
import { formatSeconds } from "../simulator-types"

// Compact summary of the landed run row: status, total duration, steps
// completed out of the graph's nodes, events, and the error + failed node
// for failed runs. Deliberately says nothing about which engine target ran
// it: that is an infrastructure detail, not part of the result.
function metric(run: WorkflowRunDetail, key: string): number | null {
  const v = run.metrics[key]
  return typeof v === "number" ? v : null
}

export function RunHeader({
  run,
  nodeLabels,
}: {
  run: WorkflowRunDetail
  nodeLabels: Map<string, string>
}) {
  const failed = run.status === "failed"
  const okSteps = metric(run, "okSteps") ?? run.steps.filter((s) => s.status === "ok").length
  const nodes = metric(run, "nodes") ?? run.definition.nodes.length
  const events = metric(run, "events") ?? run.events.length
  const parts = [
    run.durationMs !== null ? formatSeconds(run.durationMs / 1000) : null,
    `${okSteps}/${nodes} steps completed`,
    `${events} event${events === 1 ? "" : "s"}`,
  ].filter(Boolean)
  return (
    <div className="flex flex-col gap-1.5" data-testid="run-header">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <Badge variant={failed ? "destructive" : "secondary"} className="gap-1">
          {failed ? <XIcon /> : <CheckIcon />}
          {run.status}
        </Badge>
        <span>{parts.join(" · ")}</span>
      </div>
      {failed ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium break-words">{run.error ?? "Run failed"}</p>
            {run.failedNodeId ? (
              <p className="text-destructive/80">
                Failed at: {nodeLabels.get(run.failedNodeId) ?? run.failedNodeId}{" "}
                <span className="font-mono">({run.failedNodeId})</span>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
