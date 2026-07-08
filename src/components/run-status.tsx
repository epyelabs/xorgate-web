import { StatusDot } from "@/components/data-table"
import type { RunStatus } from "@/lib/workflow-run-schemas"

// Colored dot + label for a workflow run status. Shared by the device Workflows
// tab, the Workflow Instances list, and run detail (previously duplicated as
// `RunStatusCell` in runs-table-parts.tsx).
const RUN_STATUS: Record<RunStatus, { color: string; pulse?: boolean }> = {
  succeeded: { color: "bg-emerald-500" },
  running: { color: "bg-sky-500", pulse: true },
  failed: { color: "bg-destructive" },
}

export function RunStatusCell({ status }: { status: RunStatus }) {
  const { color, pulse } = RUN_STATUS[status]
  return <StatusDot color={color} label={status} pulse={pulse} />
}
