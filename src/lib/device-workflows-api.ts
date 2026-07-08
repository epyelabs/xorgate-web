import { apiRequest } from "./api"
import type {
  AttachWorkflowInput,
  DeviceWorkflowAttachment,
  ManualRunContext,
} from "./device-workflow-schemas"
import type {
  WorkflowRunSummary,
  WorkflowRunsListParams,
} from "./workflow-run-schemas"
import type { Page } from "./api"

// Serialize the standard list params into a query string suffix.
export function runsListQuery(params: WorkflowRunsListParams = {}): string {
  const qs = new URLSearchParams()
  if (params.limit !== undefined) qs.set("limit", String(params.limit))
  if (params.offset !== undefined) qs.set("offset", String(params.offset))
  if (params.order) qs.set("order", params.order)
  if (params.status) qs.set("status", params.status)
  if (params.from) qs.set("from", params.from)
  if (params.to) qs.set("to", params.to)
  return qs.toString() ? `?${qs.toString()}` : ""
}

// Real client for the device "Workflows" tab (backend: device-workflows.ts +
// workflow-runs.ts). Signatures are unchanged from the former in-memory mock, so
// the page + dialogs needed no edits; list responses are still validated by the
// same `.safeParse()` pattern in the routes.

export async function listDeviceAttachments(deviceId: string): Promise<{
  attachments: DeviceWorkflowAttachment[]
}> {
  return apiRequest(`/devices/${deviceId}/workflows`)
}

export async function listDeviceRuns(
  deviceId: string,
  params: WorkflowRunsListParams = {},
): Promise<{ runs: WorkflowRunSummary[]; page?: Page }> {
  return apiRequest(`/devices/${deviceId}/workflow-runs${runsListQuery(params)}`)
}

export async function attachWorkflow(
  deviceId: string,
  input: AttachWorkflowInput,
): Promise<{ attachment: DeviceWorkflowAttachment }> {
  return apiRequest(`/devices/${deviceId}/workflows`, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function setAttachmentEnabled(
  deviceId: string,
  attachmentId: string,
  enabled: boolean,
): Promise<{ attachment: DeviceWorkflowAttachment }> {
  return apiRequest(`/devices/${deviceId}/workflows/${attachmentId}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  })
}

export async function detachWorkflow(
  deviceId: string,
  attachmentId: string,
): Promise<void> {
  await apiRequest(`/devices/${deviceId}/workflows/${attachmentId}`, {
    method: "DELETE",
  })
}

// Ad-hoc "Run now": enqueues a one-off execution and bumps the attachment's
// denormalized run stats. `context` carries the chosen run window / recordings.
export async function runAttachmentNow(
  deviceId: string,
  attachmentId: string,
  context?: ManualRunContext,
): Promise<{ attachment: DeviceWorkflowAttachment }> {
  return apiRequest(`/devices/${deviceId}/workflows/${attachmentId}/run`, {
    method: "POST",
    body: JSON.stringify(context ?? {}),
  })
}
