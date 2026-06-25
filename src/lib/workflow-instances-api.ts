import { MOCK_RUNS } from "./mock-workflow-runs"
import type {
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "./workflow-run-schemas"

// In-memory mock backend for Workflow Instances (runs). Every exported function
// mirrors the signature the real client in `lib/api.ts` will expose, so going
// live means replacing these bodies with `apiRequest(...)` calls against the
// workspace-scoped `/workflow-runs` endpoints. Reads return deep clones so the UI
// can never mutate the store by reference.
//
// Workspace scoping note: runs are dummy, so the list ignores the real
// `currentWorkspaceId` and returns the same set; the page still re-fetches on
// workspace switch (matching the devices/templates pattern) and shows workspace
// context. Wire the real `X-Workspace-Id`-scoped endpoint to partition for real.

const db: WorkflowRunDetail[] = structuredClone(MOCK_RUNS)

const delay = (ms = 220) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function clone<T>(value: T): T {
  return structuredClone(value)
}

function toSummary(run: WorkflowRunDetail): WorkflowRunSummary {
  const {
    // strip detail-only fields
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    workspaceName: _p,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    triggeredBy: _t,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    definition: _d,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    steps: _s,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    events: _e,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    metrics: _m,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    error: _err,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    failedNodeId: _f,
    ...summary
  } = run
  return clone(summary)
}

export async function listWorkflowInstances(): Promise<{
  runs: WorkflowRunSummary[]
}> {
  await delay()
  const runs = [...db]
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .map(toSummary)
  return { runs }
}

export async function getWorkflowInstance(
  id: string,
): Promise<{ run: WorkflowRunDetail }> {
  await delay()
  const run = db.find((r) => r.id === id)
  if (!run) throw new Error(`Workflow instance not found: ${id}`)
  return { run: clone(run) }
}

// Mock re-run: a real backend would enqueue a new execution and return its id.
export async function rerunWorkflowInstance(id: string): Promise<void> {
  await delay()
  if (!db.some((r) => r.id === id)) {
    throw new Error(`Workflow instance not found: ${id}`)
  }
}
