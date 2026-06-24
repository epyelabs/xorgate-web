import { CheckIcon, MinusIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { RunStep, RunStepStatus } from "@/lib/workflow-run-schemas"

const STEP_META: Record<
  RunStepStatus,
  { dot: string; icon: typeof CheckIcon }
> = {
  ok: { dot: "bg-emerald-500/15 text-emerald-600", icon: CheckIcon },
  failed: { dot: "bg-destructive/15 text-destructive", icon: XIcon },
  skipped: { dot: "bg-muted text-muted-foreground", icon: MinusIcon },
}

// Per-node execution trace beside the read-only graph. Mirrors the simulator's
// step-list styling.
export function RunTrace({ steps }: { steps: RunStep[] }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((step, index) => {
        const meta = STEP_META[step.status]
        const Icon = meta.icon
        return (
          <li
            key={step.nodeId}
            className={cn(
              "flex items-center gap-3 rounded-md border px-3 py-2",
              step.status === "skipped"
                ? "border-dashed border-border/60"
                : "border-border bg-card",
            )}
          >
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
                meta.dot,
              )}
            >
              <Icon className="size-3" />
            </span>
            <span className="w-4 shrink-0 text-[10px] text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <span className="flex-1 truncate text-xs font-medium">{step.label}</span>
            <span
              className={cn(
                "shrink-0 text-[11px] tabular-nums",
                step.status === "failed"
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {step.output}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
