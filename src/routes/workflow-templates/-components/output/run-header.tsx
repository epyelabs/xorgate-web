import { AlertTriangleIcon, CheckIcon, XIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { WorkflowRunDetail } from "@/lib/workflow-run-schemas"
import { formatSeconds } from "../simulator-types"

// Compact summary of the landed run row (mirrors result.json): status, engine
// target, total duration, the engine's metrics, and the error + failed node
// for failed runs.
const METRIC_LABELS: Array<[key: string, label: string]> = [
  ["nodes", "nodes"],
  ["okSteps", "ok steps"],
  ["events", "events"],
  ["messages", "messages"],
]

export function RunHeader({
  run,
  engineTarget,
  nodeLabels,
}: {
  run: WorkflowRunDetail
  engineTarget: "lambda" | "fargate" | null
  nodeLabels: Map<string, string>
}) {
  const failed = run.status === "failed"
  const metrics = METRIC_LABELS.filter(([k]) => k in run.metrics).map(
    ([k, label]) => `${run.metrics[k]} ${label}`,
  )
  return (
    <div className="flex flex-col gap-1.5" data-testid="run-header">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <Badge variant={failed ? "destructive" : "secondary"} className="gap-1">
          {failed ? <XIcon /> : <CheckIcon />}
          {run.status}
        </Badge>
        <span>
          {engineTarget ?? "v2"} engine
          {run.durationMs !== null ? ` · ${formatSeconds(run.durationMs / 1000)}` : ""}
          {run.engineVersion !== null ? ` · engine v${run.engineVersion}` : ""}
        </span>
        {metrics.length > 0 ? (
          <span className="font-mono text-[10px]">{metrics.join(" · ")}</span>
        ) : null}
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
