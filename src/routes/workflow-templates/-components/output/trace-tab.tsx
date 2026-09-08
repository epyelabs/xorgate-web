import { CheckIcon, MinusIcon, XIcon } from "lucide-react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import type { WorkflowDefinition } from "@/lib/workflow-schemas"
import type {
  RunStepStatus,
  WorkflowRunDetail,
} from "@/lib/workflow-run-schemas"
import { formatSeconds } from "../simulator-types"

export function StepStatusIcon({ status }: { status: RunStepStatus }) {
  if (status === "ok") return <CheckIcon className="size-3 text-emerald-600" />
  if (status === "failed") return <XIcon className="size-3 text-destructive" />
  return <MinusIcon className="size-3 text-muted-foreground" />
}

const STATUS_WORD: Record<RunStepStatus, string> = {
  ok: "ok",
  failed: "failed",
  skipped: "skipped",
}

// One accordion item per step in seq order: header = status, label, node
// type, duration; body = the untruncated output, ids, and the run error when
// this is the node the run failed at.
export function TraceTab({
  run,
  definition,
  nodeLabels,
}: {
  run: WorkflowRunDetail
  definition: WorkflowDefinition | null
  nodeLabels: Map<string, string>
}) {
  const nodeTypes = new Map((definition ?? run.definition).nodes.map((n) => [n.id, n.type]))
  const steps = run.steps
    .map((s, i) => ({ ...s, order: s.seq ?? i }))
    .sort((a, b) => a.order - b.order)
  const totalMs = steps.reduce((sum, s) => sum + s.durationMs, 0)
  return (
    <div className="flex flex-col" data-testid="trace-tab">
      {steps.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          No steps were recorded for this run.
        </p>
      ) : (
        <Accordion type="multiple" className="flex flex-col">
          {steps.map((s) => {
            const failedHere = s.status === "failed" && run.failedNodeId === s.nodeId
            return (
              <AccordionItem key={`${s.order}:${s.nodeId}`} value={`${s.order}:${s.nodeId}`}>
                <AccordionTrigger className="py-1.5 hover:no-underline">
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <StepStatusIcon status={s.status} />
                    <span className="truncate text-xs font-medium text-foreground">
                      {nodeLabels.get(s.nodeId) ?? s.label}
                    </span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      {nodeTypes.get(s.nodeId) ?? ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {s.status === "skipped" ? "skipped" : formatSeconds(s.durationMs / 1000)}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="flex flex-col gap-1.5 pb-2.5">
                  <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/40 px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap break-words text-foreground">
                    {s.output || (s.status === "skipped" ? "(skipped: an upstream node did not produce its output)" : "(no output)")}
                  </pre>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
                    <dt>nodeId</dt>
                    <dd className="truncate text-foreground/80">{s.nodeId}</dd>
                    <dt>status</dt>
                    <dd className="text-foreground/80">{STATUS_WORD[s.status]}</dd>
                    <dt>durationMs</dt>
                    <dd className="text-foreground/80">{s.durationMs}</dd>
                    {s.seq !== undefined ? (
                      <>
                        <dt>seq</dt>
                        <dd className="text-foreground/80">{s.seq}</dd>
                      </>
                    ) : null}
                  </dl>
                  {failedHere && run.error ? (
                    <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] break-words text-destructive">
                      {run.error}
                    </p>
                  ) : null}
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      )}
      <p className="pt-2 text-[11px] text-muted-foreground">
        {run.durationMs !== null ? `Finished in ${formatSeconds(run.durationMs / 1000)}` : "Finished"}
        {steps.length > 0 ? ` · ${steps.length} step${steps.length === 1 ? "" : "s"}, ${formatSeconds(totalMs / 1000)} in nodes` : ""}
        .
      </p>
    </div>
  )
}
