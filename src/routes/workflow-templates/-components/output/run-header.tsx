import { AlertTriangleIcon } from "lucide-react"
import type { WorkflowRunDetail } from "@/lib/workflow-run-schemas"
import { formatSeconds } from "../simulator-types"

// Compact summary of the landed run row: total duration, steps completed out
// of the graph's nodes, events, and the error + failed node for failed runs.
// The status badge sits beside the "Output" section label (simulator-panel).
// Deliberately says nothing about which engine target ran it: that is an
// infrastructure detail, not part of the result.
function metric(run: WorkflowRunDetail, key: string): number | null {
  const v = run.metrics[key]
  return typeof v === "number" ? v : null
}

/** Steps that completed ok out of the graph's nodes (the engine's metrics, else counted). */
export function stepCounts(run: WorkflowRunDetail): {
  ok: number
  nodes: number
} {
  return {
    ok:
      metric(run, "okSteps") ??
      run.steps.filter((s) => s.status === "ok").length,
    nodes: metric(run, "nodes") ?? run.definition.nodes.length,
  }
}

export function RunHeader({
  run,
  nodeLabels,
}: {
  run: WorkflowRunDetail
  nodeLabels: Map<string, string>
}) {
  const failed = run.status === "failed"
  const { ok: okSteps, nodes } = stepCounts(run)
  const events = metric(run, "events") ?? run.events.length
  const parts = [
    run.durationMs !== null ? formatSeconds(run.durationMs / 1000) : null,
    `${okSteps}/${nodes} steps completed`,
    `${events} event${events === 1 ? "" : "s"}`,
  ].filter(Boolean)
  return (
    <div className="flex flex-col gap-1.5" data-testid="run-header">
      <p className="text-[11px] text-muted-foreground">{parts.join(" · ")}</p>
      {failed ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium break-words">
              {run.error ?? "Run failed"}
            </p>
            {run.failedNodeId ? (
              <p className="text-destructive/80">
                Failed at:{" "}
                {nodeLabels.get(run.failedNodeId) ?? run.failedNodeId}{" "}
                <span className="font-mono">({run.failedNodeId})</span>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
