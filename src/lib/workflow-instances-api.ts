import { xg } from "./xorgate"
import type { PageMeta as Page } from "@xorgate/sdk"
import {
  getWorkflowRunResponseSchema,
  type WorkflowRunDetail,
  type WorkflowRunSummary,
  type WorkflowRunsListParams,
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

// Cancels an in-flight run (today: simulation runs). The backend flips the row
// to `cancelled` atomically, then stops the engine task when nothing else
// shares it; the answer is the cancelled run, same shape as GET. A run that is
// no longer running answers 409 RUN_NOT_RUNNING with the current row in
// `details.run` (see runFromCancelConflict in the simulator).
export async function cancelWorkflowInstance(
  id: string,
): Promise<{ run: WorkflowRunDetail }> {
  const raw = await xg().request("POST", `/workflow-runs/${id}/cancel`)
  const parsed = getWorkflowRunResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error("Unexpected /workflow-runs/:id/cancel response shape")
  }
  return parsed.data
}

// Presigned GET for any object under a v2 run's S3 prefix (Data Capture
// records, events.jsonl, result.json, manifest.json, visualization frames and
// MP4s, materialized inputs); the backend rejects keys outside the run's
// prefix. `download` signs a Content-Disposition: attachment override so the
// browser saves the file under a name derived from the key (the `download`
// attribute alone is ignored cross-origin). URL expires in ~5 minutes, so
// fetch fresh per download/read.
export async function getRunArtifactUrl(
  runId: string,
  key: string,
  opts: { download?: boolean } = {},
): Promise<{ url: string; expiresInSeconds: number }> {
  return xg().request("GET", `/workflow-runs/${runId}/artifact-url`, {
    query: opts.download ? { key, download: "1" } : { key },
  })
}
