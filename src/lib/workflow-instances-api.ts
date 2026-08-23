import { xg } from "./xorgate"
import type { PageMeta as Page } from "@xorgate/sdk"
import type {
  WorkflowRunDetail,
  WorkflowRunSummary,
  WorkflowRunsListParams,
} from "./workflow-run-schemas"
import { runsListQuery } from "./device-workflows-api"

// Real client for Workflow Instances (runs). Backend: workflow-runs.ts. The list
// is workspace-scoped server-side via the X-Workspace-Id header the SDK client
// attaches automatically; the page still re-fetches on workspace switch.
// Signatures are unchanged from the former mock, so no page edits were needed.

export async function listWorkflowInstances(
  params: WorkflowRunsListParams = {},
): Promise<{ runs: WorkflowRunSummary[]; page?: Page }> {
  return xg().request("GET", `/workflow-runs${runsListQuery(params)}`)
}

export async function getWorkflowInstance(
  id: string,
): Promise<{ run: WorkflowRunDetail }> {
  return xg().request("GET", `/workflow-runs/${id}`)
}

// Re-run: clones the source run's snapshot definition + trigger context into a
// fresh execution (backend returns 202 with the new run; the caller ignores it
// and refreshes the list). Simulation runs return 400 (re-run them from the
// editor's simulator instead).
export async function rerunWorkflowInstance(id: string): Promise<void> {
  await xg().request("POST", `/workflow-runs/${id}/rerun`)
}

// Presigned GET for a v2 run artifact (Data Capture records, events.jsonl,
// visualization frames). `key` must come from the run detail's `artifacts`
// map; the backend rejects keys outside the run's S3 prefix. URL expires in
// ~5 minutes, so fetch fresh per download/read.
export async function getRunArtifactUrl(
  runId: string,
  key: string,
): Promise<{ url: string; expiresInSeconds: number }> {
  return xg().request("GET", `/workflow-runs/${runId}/artifact-url`, {
    query: { key },
  })
}
