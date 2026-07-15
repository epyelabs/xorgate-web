import { apiRequest, type Page } from "./api"
import type {
  WorkflowDefinition,
  WorkflowDeployment,
  WorkflowTemplateDetail,
  WorkflowTemplateSummary,
  WorkflowTemplatesListParams,
  WorkflowTemplateVersion,
} from "./workflow-schemas"
import {
  createSimulationResponseSchema,
  createSimulationUploadResponseSchema,
  type CreateSimulationResponse,
  type SimulationApiBinding,
  type SimulationUpload,
} from "./workflow-sim-schemas"

// Real client for Workflow Templates (backend: workflow-templates.ts). Every
// function's signature is unchanged from the former in-memory mock, so the pages
// that consume it needed no edits; list/detail responses are still validated by
// the same `.safeParse()` pattern in the routes.

export async function listWorkflowTemplates(
  params: WorkflowTemplatesListParams = {},
): Promise<{ templates: WorkflowTemplateSummary[]; page?: Page }> {
  const qs = new URLSearchParams()
  if (params.limit !== undefined) qs.set("limit", String(params.limit))
  if (params.offset !== undefined) qs.set("offset", String(params.offset))
  if (params.order) qs.set("order", params.order)
  if (params.sort) qs.set("sort", params.sort)
  if (params.status) qs.set("status", params.status)
  const suffix = qs.toString() ? `?${qs.toString()}` : ""
  return apiRequest(`/workflow-templates${suffix}`)
}

export async function getWorkflowTemplate(
  id: string,
): Promise<{ template: WorkflowTemplateDetail }> {
  return apiRequest(`/workflow-templates/${id}`)
}

export async function createWorkflowTemplate(input: {
  name: string
  description?: string
}): Promise<{ template: WorkflowTemplateDetail }> {
  return apiRequest("/workflow-templates", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function updateWorkflowTemplate(
  id: string,
  updates: { name?: string; description?: string | null },
): Promise<{ template: WorkflowTemplateDetail }> {
  return apiRequest(`/workflow-templates/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  })
}

// Saves the editor's working copy. The server updates the open draft in place, or
// opens a fresh draft above the published one (see workflow-templates.ts).
export async function saveDraftVersion(
  id: string,
  definition: WorkflowDefinition,
  message?: string,
): Promise<{ template: WorkflowTemplateDetail; version: WorkflowTemplateVersion }> {
  return apiRequest(`/workflow-templates/${id}/draft`, {
    method: "PUT",
    body: JSON.stringify(message !== undefined ? { definition, message } : { definition }),
  })
}

export async function publishVersion(
  id: string,
  versionId: string,
): Promise<{ template: WorkflowTemplateDetail }> {
  return apiRequest(`/workflow-templates/${id}/versions/${versionId}/publish`, {
    method: "POST",
  })
}

export async function restoreVersion(
  id: string,
  versionId: string,
): Promise<{ template: WorkflowTemplateDetail; version: WorkflowTemplateVersion }> {
  return apiRequest(`/workflow-templates/${id}/versions/${versionId}/restore`, {
    method: "POST",
  })
}

export async function listUsage(
  id: string,
): Promise<{ instances: WorkflowDeployment[] }> {
  return apiRequest(`/workflow-templates/${id}/usage`)
}

// --- Simulation (real API, M3) ---------------------------------------------------
// A simulation is a real run of the real v2 engine over the editor's CURRENT
// draft definition (no publish required); backend workflow-simulations.ts.
// Wire contracts are frozen (plans/workflow_refactor/STATUS.md); the response
// carries the run row plus the IoT progress topics the panel subscribes to.

export async function createSimulation(
  templateId: string,
  definition: WorkflowDefinition,
  bindings: Record<string, SimulationApiBinding>,
): Promise<CreateSimulationResponse> {
  const raw = await apiRequest(`/workflow-templates/${templateId}/simulations`, {
    method: "POST",
    body: JSON.stringify({ definition, bindings }),
  })
  const parsed = createSimulationResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error("Unexpected /simulations response shape")
  }
  return parsed.data
}

// Mints a presigned S3 POST for a video/CSV simulation input. The caller then
// multipart-POSTs the file (uploadFileToS3) and binds the returned `key`.
export async function createSimulationUpload(
  templateId: string,
  input: { kind: "video" | "csv"; filename: string; contentType?: string },
): Promise<SimulationUpload> {
  const raw = await apiRequest(
    `/workflow-templates/${templateId}/simulations/uploads`,
    { method: "POST", body: JSON.stringify(input) },
  )
  const parsed = createSimulationUploadResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error("Unexpected /simulations/uploads response shape")
  }
  return parsed.data.upload
}

// Straight multipart/form-data POST to S3 (no auth headers: the signature lives
// in `fields`). The file entry must come last, after every presigned field.
export async function uploadFileToS3(
  upload: SimulationUpload,
  file: File,
): Promise<void> {
  const form = new FormData()
  for (const [name, value] of Object.entries(upload.fields)) {
    form.append(name, value)
  }
  form.append("file", file)
  const res = await fetch(upload.url, { method: "POST", body: form })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    // S3 answers presigned-POST failures with XML; surface the code if present.
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1]
    throw new Error(`Upload failed (${res.status}${code ? ` ${code}` : ""})`)
  }
}
