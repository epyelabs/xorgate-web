import { AlertTriangleIcon, BanIcon } from "lucide-react"
import type { WorkflowRunDetail } from "@/lib/workflow-run-schemas"

// The landed run's error + failed node, for failed runs; a short neutral
// "Cancelled" line for a run the user stopped; nothing for a succeeded one (the status badge with the duration sits beside the "Output"
// section label, and the tabs carry the step / event / file counts).
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
  const cancelled = run.status === "cancelled"
  // The wrapper stays mounted (hidden) so the landed state is addressable.
  return (
    <div
      className={failed || cancelled ? "flex flex-col gap-1.5" : "hidden"}
      data-testid="run-header"
    >
      {cancelled ? (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-300"
          data-testid="run-cancelled"
        >
          <BanIcon className="mt-0.5 size-3.5 shrink-0" />
          <p className="min-w-0 font-medium break-words">
            {run.error ?? "Run cancelled"}
          </p>
        </div>
      ) : null}
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
