import { isXorgateError } from "@xorgate/sdk"
import { xg } from "./xorgate"
import {
  annotationsResponseSchema,
  artifactUrlResponseSchema,
  cancelJobResponseSchema,
  createUploadsResponseSchema,
  datasetMutationResponseSchema,
  deleteItemResponseSchema,
  getDatasetResponseSchema,
  importResponseSchema,
  listDatasetsResponseSchema,
  listImportsResponseSchema,
  listItemsResponseSchema,
  listModelsResponseSchema,
  listTrainingJobsResponseSchema,
  listVersionsResponseSchema,
  modelDownloadResponseSchema,
  modelEntryResponseSchema,
  modelResponseSchema,
  registerItemsResponseSchema,
  trainingJobResponseSchema,
  versionResponseSchema,
  type AnnotationInput,
  type CreateAssistInput,
  type CreateTrainingJobInput,
  type CreateVersionInput,
  type DatasetClass,
  type DatasetsListParams,
  type ImageContentType,
  type ItemStatus,
  type ItemUpload,
  type ItemsListParams,
  type ModelsListParams,
  type TrainingJobsListParams,
} from "./models-schemas"

// Real client for the Models section (backend: datasets.ts, models.ts,
// training-jobs.ts). Like the workflow plane, these routes are outside the
// SDK's modeled surface, so every call goes through `xg().request` (auth,
// tenancy and `/v1` still applied) and is validated at the seam with the zod
// contracts in models-schemas.ts: a shape drift fails loudly here, not in a
// component.

function parse<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } }, raw: unknown, what: string): T {
  const parsed = schema.safeParse(raw)
  if (!parsed.success || parsed.data === undefined) {
    console.error(`Unexpected ${what} response shape`, parsed.error, raw)
    throw new Error(`Unexpected ${what} response shape`)
  }
  return parsed.data
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const out = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") out.set(k, String(v))
  }
  const s = out.toString()
  return s ? `?${s}` : ""
}

/** The API's error code, when the failure carries one. */
export function apiErrorCode(err: unknown): string | null {
  return isXorgateError(err) ? err.code : null
}
export function apiErrorStatus(err: unknown): number | null {
  return isXorgateError(err) && err.status !== undefined ? err.status : null
}
export function apiErrorDetails(err: unknown): Record<string, unknown> | null {
  return isXorgateError(err) && err.details ? err.details : null
}

// --- datasets -------------------------------------------------------------------------

export async function listDatasets(params: DatasetsListParams = {}) {
  return parse(
    listDatasetsResponseSchema,
    await xg().request("GET", `/datasets${qs({ ...params })}`),
    "/datasets",
  )
}

export async function getDataset(id: string) {
  return parse(getDatasetResponseSchema, await xg().request("GET", `/datasets/${id}`), "/datasets/:id").dataset
}

export async function createDataset(input: { name: string; description?: string; classes: string[] }) {
  return parse(datasetMutationResponseSchema, await xg().request("POST", "/datasets", { body: input }), "POST /datasets").dataset
}

export async function updateDataset(
  id: string,
  input: { name?: string; description?: string | null; classes?: Array<Partial<DatasetClass> & { name: string }> },
) {
  return parse(
    datasetMutationResponseSchema,
    await xg().request("PATCH", `/datasets/${id}`, { body: input }),
    "PATCH /datasets/:id",
  ).dataset
}

export async function deleteDataset(id: string): Promise<void> {
  await xg().request("DELETE", `/datasets/${id}`)
}

// --- items ------------------------------------------------------------------------------

export async function listDatasetItems(id: string, params: ItemsListParams = {}) {
  return parse(
    listItemsResponseSchema,
    await xg().request("GET", `/datasets/${id}/items${qs({ ...params })}`),
    "/datasets/:id/items",
  )
}

export async function createItemUploads(
  id: string,
  files: Array<{ filename: string; contentType: ImageContentType }>,
) {
  return parse(
    createUploadsResponseSchema,
    await xg().request("POST", `/datasets/${id}/items/uploads`, { body: { files } }),
    "POST /datasets/:id/items/uploads",
  ).uploads
}

// Straight multipart POST to S3 (no auth headers: the signature lives in
// `fields`). The file entry comes last, after every presigned field.
export async function uploadItemToS3(upload: ItemUpload, file: File): Promise<void> {
  const form = new FormData()
  for (const [name, value] of Object.entries(upload.fields)) form.append(name, value)
  form.append("file", file)
  const res = await fetch(upload.url, { method: "POST", body: form })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1]
    throw new Error(`Upload failed (${res.status}${code ? ` ${code}` : ""})`)
  }
}

export async function registerItems(id: string, keys: string[], groupKey?: string) {
  return parse(
    registerItemsResponseSchema,
    await xg().request("POST", `/datasets/${id}/items`, {
      body: groupKey ? { keys, groupKey } : { keys },
    }),
    "POST /datasets/:id/items",
  )
}

export async function deleteItem(id: string, itemId: string) {
  return parse(
    deleteItemResponseSchema,
    await xg().request("DELETE", `/datasets/${id}/items/${itemId}`),
    "DELETE /datasets/:id/items/:itemId",
  )
}

// --- annotations --------------------------------------------------------------------

export async function getAnnotations(id: string, itemId: string) {
  return parse(
    annotationsResponseSchema,
    await xg().request("GET", `/datasets/${id}/items/${itemId}/annotations`),
    "/datasets/:id/items/:itemId/annotations",
  )
}

// Replace-all with the etag the client last read. The backend answers 412
// PRECONDITION_FAILED when the item changed underneath (another tab), and
// hands the new etag back in the body of every success.
export async function putAnnotations(
  id: string,
  itemId: string,
  etag: string,
  body: { annotations: AnnotationInput[]; status?: Exclude<ItemStatus, "excluded"> },
) {
  return parse(
    annotationsResponseSchema,
    await xg().request("PUT", `/datasets/${id}/items/${itemId}/annotations`, {
      body,
      headers: { "If-Match": etag },
    }),
    "PUT /datasets/:id/items/:itemId/annotations",
  )
}

// --- imports ----------------------------------------------------------------------------

export async function listImports(id: string) {
  return parse(listImportsResponseSchema, await xg().request("GET", `/datasets/${id}/imports`), "/datasets/:id/imports").imports
}

export async function createRecordingImport(
  id: string,
  input: { sessionId: string; everySeconds?: number; fps?: number; maxFrames?: number; from?: string; to?: string },
) {
  return parse(
    importResponseSchema,
    await xg().request("POST", `/datasets/${id}/imports`, { body: { kind: "recording", ...input } }),
    "POST /datasets/:id/imports",
  ).import
}

export async function getImport(id: string, importId: string) {
  return parse(importResponseSchema, await xg().request("GET", `/datasets/${id}/imports/${importId}`), "/datasets/:id/imports/:importId").import
}

// --- assist -------------------------------------------------------------------------------

export async function createAssistJob(id: string, input: CreateAssistInput) {
  return parse(
    trainingJobResponseSchema,
    await xg().request("POST", `/datasets/${id}/assist`, { body: input }),
    "POST /datasets/:id/assist",
  ).job
}

// --- versions ------------------------------------------------------------------------------

export async function listVersions(id: string) {
  return parse(listVersionsResponseSchema, await xg().request("GET", `/datasets/${id}/versions`), "/datasets/:id/versions").versions
}

export async function createVersion(id: string, input: CreateVersionInput) {
  return parse(
    versionResponseSchema,
    await xg().request("POST", `/datasets/${id}/versions`, { body: input }),
    "POST /datasets/:id/versions",
  )
}

export async function getVersion(id: string, version: number) {
  return parse(versionResponseSchema, await xg().request("GET", `/datasets/${id}/versions/${version}`), "/datasets/:id/versions/:v").version
}

// --- training jobs --------------------------------------------------------------------------

export async function listTrainingJobs(params: TrainingJobsListParams = {}) {
  return parse(
    listTrainingJobsResponseSchema,
    await xg().request("GET", `/training-jobs${qs({ ...params })}`),
    "/training-jobs",
  )
}

export async function createTrainingJob(input: CreateTrainingJobInput) {
  return parse(trainingJobResponseSchema, await xg().request("POST", "/training-jobs", { body: input }), "POST /training-jobs").job
}

export async function getTrainingJob(id: string) {
  return parse(trainingJobResponseSchema, await xg().request("GET", `/training-jobs/${id}`), "/training-jobs/:id").job
}

export async function cancelTrainingJob(id: string) {
  return parse(cancelJobResponseSchema, await xg().request("POST", `/training-jobs/${id}/cancel`), "POST /training-jobs/:id/cancel")
}

// Presigned GET for one object under training/<jobId>/ (result.json, the eval
// samples, train.log, the confusion matrix). URLs expire in 15 minutes.
export async function getJobArtifactUrl(id: string, key: string): Promise<string> {
  return parse(
    artifactUrlResponseSchema,
    await xg().request("GET", `/training-jobs/${id}/artifact-url${qs({ key })}`),
    "/training-jobs/:id/artifact-url",
  ).url
}

// --- registry ---------------------------------------------------------------------------------

export async function listModels(params: ModelsListParams = {}) {
  return parse(
    listModelsResponseSchema,
    await xg().request(
      "GET",
      `/models${qs({ family: params.family, scope: params.scope, includeArchived: params.includeArchived ? "1" : undefined })}`,
    ),
    "/models",
  )
}

export async function getModel(id: string) {
  return parse(modelResponseSchema, await xg().request("GET", `/models/${encodeURIComponent(id)}`), "/models/:id").model
}

export async function patchModel(id: string, input: { label?: string | null; status?: "ready" | "archived" }) {
  return parse(modelEntryResponseSchema, await xg().request("PATCH", `/models/${id}`, { body: input }), "PATCH /models/:id").model
}

export async function deleteModel(id: string): Promise<void> {
  await xg().request("DELETE", `/models/${id}`)
}

export async function getModelDownload(id: string) {
  return parse(modelDownloadResponseSchema, await xg().request("GET", `/models/${encodeURIComponent(id)}/download`), "/models/:id/download")
}

// Triggers a browser download of a presigned URL (the URL carries a signed
// Content-Disposition so the file lands under its own name).
export function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
}
