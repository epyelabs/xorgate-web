import { apiRequest, type Page } from "./api"
import type {
  WorkflowRunDetail,
  WorkflowRunSummary,
  WorkflowRunsListParams,
} from "./workflow-run-schemas"
import { runsListQuery } from "./device-workflows-api"

// Real client for Workflow Instances (runs). Backend: workflow-runs.ts. The list
// is workspace-scoped server-side via the X-Workspace-Id header that apiRequest
// attaches automatically; the page still re-fetches on workspace switch.
// Signatures are unchanged from the former mock, so no page edits were needed.

export async function listWorkflowInstances(
  params: WorkflowRunsListParams = {},
): Promise<{ runs: WorkflowRunSummary[]; page?: Page }> {
  return apiRequest(`/workflow-runs${runsListQuery(params)}`)
}

export async function getWorkflowInstance(
  id: string,
): Promise<{ run: WorkflowRunDetail }> {
  return apiRequest(`/workflow-runs/${id}`)
}

// Re-run: clones the source run's snapshot definition + trigger context into a
// fresh execution (backend returns 202 with the new run; the caller ignores it
// and refreshes the list).
export async function rerunWorkflowInstance(id: string): Promise<void> {
  await apiRequest(`/workflow-runs/${id}/rerun`, { method: "POST" })
}
