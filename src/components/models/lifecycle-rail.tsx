import type { ReactNode } from "react"
import { Link, type LinkProps } from "@tanstack/react-router"
import { CheckIcon, ChevronRightIcon, XIcon, type LucideIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

// The one map every Models page shares: frames become labels, labels freeze
// into a version, a version trains a job, a job publishes a model, a model
// is named by workflows. Each page marks where its entity sits and fills the
// other stages from what it knows, so a user landing on any of the three
// detail pages can see what came before and what comes next, and jump there.
export type LifecycleState = "done" | "active" | "current" | "pending" | "failed"

export interface LifecycleStage {
  key: string
  label: string
  icon: LucideIcon
  state: LifecycleState
  /** One short line under the label: a count, a status, a name. */
  summary?: ReactNode
  /** Where the stage leads; a stage with no link is plain text. */
  link?: LinkProps
  testId?: string
}

const ICON_STYLE: Record<LifecycleState, string> = {
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  active: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  current: "bg-foreground text-background",
  pending: "bg-muted text-muted-foreground",
  failed: "bg-destructive/10 text-destructive",
}

function StageBody({ stage }: { stage: LifecycleStage }) {
  const Icon = stage.icon
  return (
    <>
      <span
        className={cn(
          "relative flex size-7 shrink-0 items-center justify-center rounded-full",
          ICON_STYLE[stage.state],
          stage.state === "active" ? "animate-pulse" : "",
        )}
        aria-hidden
      >
        <Icon className="size-3.5" />
        {stage.state === "done" ? (
          <span className="absolute -right-0.5 -bottom-0.5 flex size-3 items-center justify-center rounded-full bg-emerald-500 text-white ring-2 ring-card">
            <CheckIcon className="size-2" strokeWidth={3} />
          </span>
        ) : stage.state === "failed" ? (
          <span className="absolute -right-0.5 -bottom-0.5 flex size-3 items-center justify-center rounded-full bg-destructive text-white ring-2 ring-card">
            <XIcon className="size-2" strokeWidth={3} />
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span
          className={cn(
            "truncate text-xs font-medium",
            stage.state === "pending" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {stage.label}
        </span>
        {stage.summary ? (
          <span className="truncate text-[11px] text-muted-foreground">{stage.summary}</span>
        ) : null}
      </span>
    </>
  )
}

export function LifecycleRail({ stages, className }: { stages: LifecycleStage[]; className?: string }) {
  return (
    <Card size="sm" className={cn("py-0", className)} data-testid="lifecycle-rail">
      <ol className="grid grid-cols-2 gap-x-1 sm:grid-cols-3 lg:flex lg:flex-row lg:items-stretch">
        {stages.map((stage, i) => {
          const inner = (
            <span
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-2",
                stage.link ? "transition-colors hover:bg-muted/60" : "",
              )}
            >
              <StageBody stage={stage} />
            </span>
          )
          return (
            <li
              key={stage.key}
              className="flex min-w-0 flex-1 items-center"
              data-stage={stage.key}
              data-state={stage.state}
              data-testid={stage.testId}
              aria-current={stage.state === "current" ? "step" : undefined}
            >
              {stage.link ? (
                <Link {...stage.link} className="flex min-w-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                  {inner}
                </Link>
              ) : (
                inner
              )}
              {i < stages.length - 1 ? (
                <ChevronRightIcon className="hidden size-3.5 shrink-0 text-muted-foreground/50 lg:block" aria-hidden />
              ) : null}
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
