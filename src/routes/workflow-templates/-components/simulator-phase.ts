import { isXorgateError } from "@xorgate/sdk"
import {
  workflowRunDetailSchema,
  type RunStatus,
  type WorkflowRunDetail,
} from "@/lib/workflow-run-schemas"

// Pure state helpers for the simulator panel (kept out of the component so
// they are unit-testable).

// idle -> preparing (uploads/window resolution + POST) -> running (live
// progress over IoT + run-row polling) -> succeeded | failed | cancelled. The
// run row is the terminal source of truth; IoT topics are the live view only.
export type SimPhase =
  | "idle"
  | "preparing"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"

export type TerminalSimPhase = Extract<
  SimPhase,
  "succeeded" | "failed" | "cancelled"
>

/** The panel phase a run row's status puts it in. */
export function phaseForRunStatus(status: RunStatus): SimPhase {
  switch (status) {
    case "running":
      return "running"
    case "succeeded":
      return "succeeded"
    case "failed":
      return "failed"
    case "cancelled":
      return "cancelled"
  }
}

export function isTerminalPhase(phase: SimPhase): phase is TerminalSimPhase {
  return phase === "succeeded" || phase === "failed" || phase === "cancelled"
}

const pad = (n: number) => String(n).padStart(2, "0")

/** Default name for a saved run: `Simulation YYYY-MM-DD HH:mm` (local time). */
export function defaultSaveName(at: Date): string {
  const d = Number.isNaN(at.getTime()) ? new Date() : at
  return `Simulation ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * For a failed cancel: whether it is the 409 RUN_NOT_RUNNING race (the run
 * landed or was cancelled elsewhere first), and the current run row the
 * backend put in `details.run`, if it parses. `run` is null when the details
 * carry no usable row, so the caller re-reads it.
 */
export function cancelConflict(
  err: unknown
): { run: WorkflowRunDetail | null } | null {
  if (!isXorgateError(err)) return null
  // The SDK passes unknown API codes through verbatim; its union type does
  // not list this one.
  if (err.status !== 409 || (err.code as string) !== "RUN_NOT_RUNNING")
    return null
  const parsed = workflowRunDetailSchema.safeParse(err.details?.run)
  return { run: parsed.success ? parsed.data : null }
}
