import { z } from "zod"
import { pageSchema } from "./schemas"

// Zod contracts for the Models section (datasets, items, annotations, imports,
// versions, training jobs, the registry). They mirror what the backend SHIPS
// (xorgate-core-service src/handlers/{datasets,models,training-jobs}.ts), read
// off real dev responses on 2026-09-13, not what design §4c sketched. Every
// response is camelCase (the handlers build their own objects; nothing here
// serializes a drizzle row verbatim). Naming hazard: `device_models` and
// `qk.deviceModels` are hardware SKUs; everything in this file is a trained
// network.

// --- rules mirrored from the backend (src/models/names.ts, classes.ts, keys.ts)

export const MODEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const MODEL_NAME_MAX = 64
export const DATASET_NAME_MAX = 80
export const CLASS_NAME_MAX = 48
export const MAX_CLASSES = 64
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_ITEMS_PER_DATASET = 5000
export const MAX_IMPORT_FRAMES = 500
export const MAX_UPLOADS_PER_CALL = 50
export const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png"] as const
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number]

/** Twelve distinguishable colors; the backend assigns them in this order. */
export const CLASS_PALETTE: readonly string[] = [
  "#e6194b",
  "#3cb44b",
  "#ffe119",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#46f0f0",
  "#f032e6",
  "#bcf60c",
  "#fabebe",
  "#008080",
  "#e6beff",
]

/** `null` when the name is valid; otherwise the backend's own refusal text. */
export function modelNameError(name: string): string | null {
  if (name.length === 0) return "Model name is required"
  if (name.length > MODEL_NAME_MAX)
    return `Model name must be at most ${MODEL_NAME_MAX} characters`
  if (name.includes("@"))
    return 'Model name must not contain "@" (the version pin is separate)'
  if (!MODEL_NAME_RE.test(name)) {
    return 'Model name must start with a letter or digit and contain only letters, digits, ".", "_" or "-"'
  }
  return null
}

export function classNameError(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return "Class name is required"
  if (trimmed.length > CLASS_NAME_MAX)
    return `Class name must be at most ${CLASS_NAME_MAX} characters`
  return null
}

// --- training constants (src/models/training.ts) --------------------------------

export const TRAINING_TARGETS = ["cpu", "gpu"] as const
export type TrainingTarget = (typeof TRAINING_TARGETS)[number]
export const TARGET_INSTANCE_TYPES: Record<TrainingTarget, readonly string[]> = {
  cpu: ["ml.m5.xlarge", "ml.m5.2xlarge"],
  gpu: ["ml.g4dn.xlarge", "ml.g6.xlarge"],
}
export const DEFAULT_INSTANCE_TYPE: Record<TrainingTarget, string> = {
  cpu: "ml.m5.xlarge",
  gpu: "ml.g4dn.xlarge",
}
export const DEFAULT_SPOT: Record<TrainingTarget, boolean> = { cpu: false, gpu: true }
export const DEFAULT_MAX_MINUTES = 60
export const MAX_MAX_MINUTES = 240
export const DEFAULT_ASSIST_MAX_MINUTES = 30
export const TRAINING_MODES = ["fast", "accurate"] as const
export type TrainingMode = (typeof TRAINING_MODES)[number]
export const TRAINING_STATUSES = [
  "queued",
  "dispatched",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const
export type TrainingStatus = (typeof TRAINING_STATUSES)[number]
export const ACTIVE_TRAINING_STATUSES: readonly TrainingStatus[] = [
  "queued",
  "dispatched",
  "running",
]
export function isActiveTrainingStatus(status: string): boolean {
  return (ACTIVE_TRAINING_STATUSES as readonly string[]).includes(status)
}

export interface RecipeInfo {
  id: string
  label: string
  license: string
  /** Base weights the recipe carries, in the forge image. */
  bases: readonly string[]
  modes: Record<TrainingMode, string>
}
export const RECIPES: readonly RecipeInfo[] = [
  {
    id: "yolov8",
    label: "YOLOv8 (Ultralytics)",
    license: "AGPL-3.0",
    bases: ["yolov8n", "yolov8s"],
    modes: {
      fast: "50 epochs at 640 px, early stop after 10 quiet epochs",
      accurate: "150 epochs at 640 px, early stop after 30 quiet epochs",
    },
  },
]

// Static duration and cost lines for the Train dialog (design §4g, us-east-1
// list prices, for about 1,000 images at 640 px; order of magnitude). The
// budget a user picks bounds the CONTAINER, not the wall clock: provisioning
// and the image pull (about a minute) are not billed and not counted.
export interface TrainingEstimate {
  instanceType: string
  hourlyUsd: number
  spot: boolean
  duration: Record<TrainingMode, string>
  cost: Record<TrainingMode, string>
}
export const TRAINING_ESTIMATES: Record<TrainingTarget, TrainingEstimate> = {
  cpu: {
    instanceType: "ml.m5.xlarge",
    hourlyUsd: 0.23,
    spot: false,
    duration: { fast: "4 to 8 h", accurate: "a day or more" },
    cost: { fast: "$0.90 to $1.80", accurate: "$5 or more" },
  },
  gpu: {
    instanceType: "ml.g4dn.xlarge",
    hourlyUsd: 0.74,
    spot: true,
    duration: { fast: "45 to 90 min", accurate: "3 to 6 h" },
    cost: { fast: "$0.17 to $0.33 (spot)", accurate: "$0.70 to $1.30 (spot)" },
  },
}

// --- datasets --------------------------------------------------------------------

export const datasetClassSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
})
export type DatasetClass = z.infer<typeof datasetClassSchema>

export const datasetSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  task: z.string(),
  classes: z.array(datasetClassSchema),
  itemCount: z.number(),
  labeledCount: z.number(),
  versionCount: z.number(),
  latestVersion: z.number().nullable(),
  createdByUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DatasetSummary = z.infer<typeof datasetSummarySchema>

export const datasetDetailSchema = datasetSummarySchema.extend({
  itemsByStatus: z.record(z.string(), z.number()).default({}),
  classUsage: z.record(z.string(), z.number()).default({}),
})
export type DatasetDetail = z.infer<typeof datasetDetailSchema>

export const listDatasetsResponseSchema = z.object({
  datasets: z.array(datasetSummarySchema),
  page: pageSchema.optional(),
})
export const getDatasetResponseSchema = z.object({ dataset: datasetDetailSchema })
export const datasetMutationResponseSchema = z.object({ dataset: datasetSummarySchema })

export interface DatasetsListParams {
  limit?: number
  offset?: number
  sort?: "createdAt" | "updatedAt" | "name"
  order?: "asc" | "desc"
}

// --- items and annotations --------------------------------------------------------

export const ITEM_STATUSES = ["unlabeled", "ai_labeled", "labeled", "excluded"] as const
export type ItemStatus = (typeof ITEM_STATUSES)[number]
export const ITEM_SOURCE_KINDS = ["upload", "recording", "run_capture"] as const
export type ItemSourceKind = (typeof ITEM_SOURCE_KINDS)[number]

export const datasetItemSchema = z.object({
  id: z.string(),
  datasetId: z.string(),
  key: z.string(),
  // Null on a register response (no presign); a 15-minute presigned GET on a
  // list or an annotations read.
  url: z.string().nullable(),
  width: z.number(),
  height: z.number(),
  bytes: z.number(),
  sha256: z.string(),
  source: z.looseObject({ kind: z.string() }),
  groupKey: z.string().nullable(),
  status: z.enum(ITEM_STATUSES),
  annotationCount: z.number(),
  labeledByUserId: z.string().nullable(),
  labeledAt: z.string().nullable(),
  etag: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DatasetItem = z.infer<typeof datasetItemSchema>

export const listItemsResponseSchema = z.object({
  items: z.array(datasetItemSchema),
  page: pageSchema.optional(),
})

export interface ItemsListParams {
  limit?: number
  offset?: number
  order?: "asc" | "desc"
  status?: ItemStatus
  class?: string
  source?: ItemSourceKind
  group?: string
}

export const ANNOTATION_SOURCES = ["human", "model", "import"] as const
export type AnnotationSource = (typeof ANNOTATION_SOURCES)[number]

export const annotationSchema = z.object({
  id: z.string(),
  classId: z.string(),
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  source: z.enum(ANNOTATION_SOURCES),
  sourceRef: z.string().nullable(),
  confidence: z.number().nullable(),
  createdAt: z.string(),
})
export type Annotation = z.infer<typeof annotationSchema>

export const annotationsResponseSchema = z.object({
  item: datasetItemSchema,
  annotations: z.array(annotationSchema),
  etag: z.string(),
})
export type AnnotationsResponse = z.infer<typeof annotationsResponseSchema>

/** One box on the wire for the replace-all PUT (the id is not sent). */
export interface AnnotationInput {
  classId: string
  x1: number
  y1: number
  x2: number
  y2: number
  source?: AnnotationSource
  sourceRef?: string | null
  confidence?: number | null
}

export const uploadSchema = z.object({
  itemId: z.string(),
  key: z.string(),
  filename: z.string(),
  url: z.string(),
  fields: z.record(z.string(), z.string()),
  expiresInSeconds: z.number(),
  maxBytes: z.number(),
})
export type ItemUpload = z.infer<typeof uploadSchema>
export const createUploadsResponseSchema = z.object({ uploads: z.array(uploadSchema) })

export const registerItemsResponseSchema = z.object({
  items: z.array(datasetItemSchema),
  duplicates: z.array(z.object({ key: z.string(), itemId: z.string() })),
  rejected: z.array(z.object({ key: z.string(), reason: z.string() })),
})
export type RegisterItemsResponse = z.infer<typeof registerItemsResponseSchema>

export const deleteItemResponseSchema = z.union([
  z.object({ action: z.literal("deleted"), itemId: z.string() }),
  z.object({ action: z.literal("excluded"), item: datasetItemSchema, reason: z.string() }),
])

// --- imports -------------------------------------------------------------------------

export const IMPORT_STATUSES = ["queued", "running", "succeeded", "failed"] as const
export const datasetImportSchema = z.object({
  id: z.string(),
  datasetId: z.string(),
  kind: z.string(),
  params: z.record(z.string(), z.unknown()),
  status: z.enum(IMPORT_STATUSES),
  progress: z.record(z.string(), z.unknown()).nullable(),
  itemsAdded: z.number(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DatasetImport = z.infer<typeof datasetImportSchema>
export const listImportsResponseSchema = z.object({ imports: z.array(datasetImportSchema) })
export const importResponseSchema = z.object({ import: datasetImportSchema })
export function isActiveImportStatus(status: string): boolean {
  return status === "queued" || status === "running"
}

// --- versions -------------------------------------------------------------------------

export const VERSION_STATUSES = ["building", "ready", "failed"] as const
const splitCountsSchema = z.object({
  train: z.number(),
  val: z.number(),
  test: z.number(),
})
export type SplitCounts = z.infer<typeof splitCountsSchema>
export const versionStatsSchema = z.object({
  images: splitCountsSchema,
  annotations: splitCountsSchema,
  perClass: z.record(z.string(), splitCountsSchema),
  emptyImages: splitCountsSchema.optional(),
})
export type VersionStats = z.infer<typeof versionStatsSchema>
const healthIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  className: z.string().optional(),
})
export type HealthIssue = z.infer<typeof healthIssueSchema>
export const versionHealthSchema = z.object({
  ok: z.boolean(),
  errors: z.array(healthIssueSchema),
  warnings: z.array(healthIssueSchema),
})
export type VersionHealth = z.infer<typeof versionHealthSchema>

export const datasetVersionSchema = z.object({
  id: z.string(),
  datasetId: z.string(),
  version: z.number(),
  message: z.string().nullable(),
  splitConfig: z.record(z.string(), z.unknown()),
  classNames: z.array(z.string()),
  stats: versionStatsSchema.nullable(),
  health: versionHealthSchema.nullable(),
  s3Prefix: z.string(),
  status: z.enum(VERSION_STATUSES),
  error: z.string().nullable(),
  // Presigned GETs for the three version files, only on the detail read of a
  // ready version.
  files: z.record(z.string(), z.string()).nullable().optional(),
  readyAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DatasetVersion = z.infer<typeof datasetVersionSchema>
export const listVersionsResponseSchema = z.object({ versions: z.array(datasetVersionSchema) })
export const versionResponseSchema = z.object({
  version: datasetVersionSchema,
  preview: z
    .object({ splitCounts: z.record(z.string(), z.unknown()), droppedBoxes: z.number() })
    .optional(),
})

export interface CreateVersionInput {
  message?: string
  split: { train: number; val: number; test: number }
  seed: number
  keepPrevious: boolean
  includeAiLabeled: boolean
}

// The 400 a POST /versions answers when the health check fails: the same
// health block a ready version carries, so the dialog can render it before a
// row exists.
export const versionUnhealthyDetailsSchema = z.object({
  health: versionHealthSchema,
  stats: versionStatsSchema.optional(),
})

// --- training jobs ---------------------------------------------------------------------

export const TRAINING_TASKS = ["train", "autolabel"] as const
export type TrainingTask = (typeof TRAINING_TASKS)[number]

const perClassMetricSchema = z.looseObject({
  name: z.string(),
  mAP50: z.number().nullable().optional(),
  mAP50_95: z.number().nullable().optional(),
  precision: z.number().nullable().optional(),
  recall: z.number().nullable().optional(),
  instances: z.number().nullable().optional(),
})
export type PerClassMetric = z.infer<typeof perClassMetricSchema>

// Metrics of a `train` job (from result.json) or the label counts of an
// `autolabel` job; both loose because the forge may add fields (M1: additive).
export const jobMetricsSchema = z.looseObject({
  mAP50: z.number().nullable().optional(),
  mAP50_95: z.number().nullable().optional(),
  precision: z.number().nullable().optional(),
  recall: z.number().nullable().optional(),
  epochsCompleted: z.number().nullable().optional(),
  perClass: z.array(perClassMetricSchema).optional(),
  hyperparameters: z.record(z.string(), z.unknown()).optional(),
  labels: z
    .looseObject({
      boxes: z.number().optional(),
      images: z.number().optional(),
      perClass: z.record(z.string(), z.number()).optional(),
      unmapped: z.record(z.string(), z.number()).optional(),
    })
    .optional(),
  applied: z
    .looseObject({
      boxes: z.number().optional(),
      itemsLabeled: z.number().optional(),
      unknownImages: z.number().optional(),
      unknownClasses: z.array(z.string()).optional(),
    })
    .optional(),
})
export type JobMetrics = z.infer<typeof jobMetricsSchema>

export const jobArtifactsSchema = z.looseObject({
  prefix: z.string().optional(),
  files: z.number().optional(),
  model: z.string().nullable().optional(),
  labels: z.string().nullable().optional(),
  weights: z.string().nullable().optional(),
  trainLog: z.string().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  check: z
    .looseObject({ ok: z.boolean(), lines: z.array(z.string()).optional() })
    .nullable()
    .optional(),
  eval: z
    .looseObject({
      metrics: z.string().optional(),
      confusion: z.string().optional(),
      samples: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
})
export type JobArtifacts = z.infer<typeof jobArtifactsSchema>

export const trainingJobSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  datasetId: z.string().nullable(),
  datasetVersionId: z.string().nullable(),
  task: z.enum(TRAINING_TASKS),
  recipe: z.string(),
  base: z.looseObject({ ref: z.string(), kind: z.string() }).nullable(),
  mode: z.string().nullable(),
  target: z.enum(TRAINING_TARGETS),
  compute: z
    .looseObject({
      target: z.string().optional(),
      instanceType: z.string().optional(),
      spot: z.boolean().optional(),
      maxMinutes: z.number().optional(),
      maxRuntimeSeconds: z.number().optional(),
    })
    .nullable(),
  status: z.enum(TRAINING_STATUSES),
  externalRef: z.string().nullable(),
  progress: z
    .looseObject({
      phase: z.string().nullable().optional(),
      epochsCompleted: z.number().nullable().optional(),
      stopRequestedAt: z.string().optional(),
    })
    .nullable(),
  metrics: jobMetricsSchema.nullable(),
  artifacts: jobArtifactsSchema.nullable(),
  // The forge's own phase and message on a failed job (never SageMaker's
  // FailureReason, which says nothing); "Stopped" on a cancelled one.
  error: z.string().nullable(),
  outputModelId: z.string().nullable(),
  billableSeconds: z.number().nullable(),
  output: z
    .looseObject({
      name: z.string(),
      label: z.string().nullable().optional(),
      family: z.string().optional(),
      version: z.number().optional(),
    })
    .nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  createdByUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  recipeLicense: z.string().nullable().optional(),
})
export type TrainingJob = z.infer<typeof trainingJobSchema>

// One parsed line of progress.jsonl (forge progress v1; additive).
export const progressLineSchema = z.looseObject({
  t: z.string(),
  at: z.string().optional(),
  status: z.string().optional(),
  phase: z.string().optional(),
  epoch: z.number().optional(),
  epochs: z.number().optional(),
  mAP50: z.number().nullable().optional(),
  loss: z.number().nullable().optional(),
  line: z.string().optional(),
})
export type ProgressLine = z.infer<typeof progressLineSchema>

export const progressTailSchema = z.object({
  lines: z.array(progressLineSchema).default([]),
  phase: z.string().nullable(),
  epoch: z.number().nullable(),
  epochs: z.number().nullable(),
  lastEpochMap50: z.number().nullable().optional(),
  lastLine: z.string().nullable(),
  skipped: z.number().optional(),
})
export type ProgressTail = z.infer<typeof progressTailSchema>

export const artifactIndexEntrySchema = z.object({
  key: z.string(),
  name: z.string(),
  bytes: z.number(),
})
export type ArtifactIndexEntry = z.infer<typeof artifactIndexEntrySchema>

export const trainingJobDetailSchema = trainingJobSchema.extend({
  spec: z.record(z.string(), z.unknown()).nullable().optional(),
  progressTail: progressTailSchema.nullable().optional(),
  artifactIndex: z.array(artifactIndexEntrySchema).default([]),
  outputModel: z
    .object({
      id: z.string(),
      family: z.string(),
      name: z.string(),
      version: z.number(),
      label: z.string().nullable(),
    })
    .nullable()
    .optional(),
  terminal: z.boolean().optional(),
})
export type TrainingJobDetail = z.infer<typeof trainingJobDetailSchema>

export const listTrainingJobsResponseSchema = z.object({
  jobs: z.array(trainingJobSchema),
  page: pageSchema.optional(),
})
export const trainingJobResponseSchema = z.object({ job: trainingJobDetailSchema })
export const cancelJobResponseSchema = z.object({
  job: trainingJobSchema,
  stopping: z.boolean(),
})

export interface TrainingJobsListParams {
  limit?: number
  offset?: number
  sort?: "createdAt" | "updatedAt"
  order?: "asc" | "desc"
  status?: TrainingStatus
  task?: TrainingTask
  datasetId?: string
}

export interface CreateTrainingJobInput {
  datasetVersionId: string
  recipe: string
  base: { kind: "pretrained"; ref: string }
  output: { name: string; label?: string }
  mode: TrainingMode
  hyperparameters?: {
    epochs?: number
    imgsz?: number
    batch?: number | "auto"
    patience?: number
    seed?: number
  }
  target: TrainingTarget
  instanceType?: string
  spot?: boolean
  limits: { maxMinutes: number }
}

export interface CreateAssistInput {
  model: string
  family?: string
  minConfidence: number
  classMap?: Record<string, string>
  items: "unlabeled" | "all"
  maxItems?: number
  target: TrainingTarget
  limits: { maxMinutes: number }
}

export const artifactUrlResponseSchema = z.object({
  url: z.string(),
  expiresInSeconds: z.number().optional(),
})

// eval/confusion.json as the forge writes it.
export const confusionSchema = z.looseObject({
  classes: z.array(z.string()),
  rows: z.string().optional(),
  columns: z.string().optional(),
  confidence: z.number().optional(),
  iou: z.number().optional(),
  matrix: z.array(z.array(z.number())),
})
export type Confusion = z.infer<typeof confusionSchema>

// --- registry ---------------------------------------------------------------------------

export const MODEL_SCOPES = ["platform", "organization"] as const
export type ModelScope = (typeof MODEL_SCOPES)[number]

// The engine's manifest v1 plus the forge's provenance block, kept loose on
// purpose: the platform publishes it byte for byte and the FE must never
// round-trip it through a strict schema (M3 gotcha).
export const modelManifestSchema = z.looseObject({
  manifestVersion: z.number().optional(),
  family: z.string().optional(),
  name: z.string().optional(),
  version: z.number().optional(),
  label: z.string().optional(),
  backend: z.string().optional(),
  classNames: z.array(z.string()).optional(),
  input: z
    .looseObject({
      width: z.number().optional(),
      height: z.number().optional(),
      layout: z.string().optional(),
      colorSpace: z.string().optional(),
    })
    .optional(),
  files: z
    .record(
      z.string(),
      z.looseObject({ sha256: z.string().optional(), sizeBytes: z.number().optional() }),
    )
    .optional(),
  provenance: z.record(z.string(), z.unknown()).optional(),
  quantization: z.string().optional(),
})
export type ModelManifest = z.infer<typeof modelManifestSchema>

export const modelProvenanceSchema = z.looseObject({
  jobId: z.string().nullable().optional(),
  recipe: z.string().optional(),
  base: z.looseObject({ ref: z.string().optional(), kind: z.string().optional() }).optional(),
  metrics: z.record(z.string(), z.number().nullable()).optional(),
  datasetId: z.string().optional(),
  datasetVersionId: z.string().optional(),
  trainedAt: z.string().optional(),
  epochsCompleted: z.number().optional(),
})

export const modelEntrySchema = z.object({
  // A uuid for an organization model; `platform:<family>:<name>@<version>`
  // for a platform one (colons, so it survives a path segment).
  id: z.string(),
  scope: z.enum(MODEL_SCOPES),
  family: z.string(),
  name: z.string(),
  version: z.number(),
  label: z.string(),
  classNames: z.array(z.string()),
  status: z.enum(["ready", "archived"]),
  manifest: modelManifestSchema,
  s3Prefix: z.string(),
  provenance: modelProvenanceSchema.nullable(),
  createdByUserId: z.string().nullable().optional(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable().optional(),
})
export type ModelEntry = z.infer<typeof modelEntrySchema>

export const modelUsageSchema = z.object({
  templateId: z.string(),
  templateName: z.string(),
  version: z.number(),
  nodeId: z.string(),
})
export type ModelUsage = z.infer<typeof modelUsageSchema>

export const modelDetailSchema = modelEntrySchema.extend({
  lineage: z
    .object({
      datasetId: z.string(),
      datasetName: z.string(),
      datasetVersion: z.number(),
      datasetVersionId: z.string(),
      jobId: z.string().nullable(),
    })
    .nullable(),
  versions: z
    .array(z.object({ id: z.string(), version: z.number(), status: z.string() }))
    .optional(),
  usage: z.array(modelUsageSchema).default([]),
})
export type ModelDetail = z.infer<typeof modelDetailSchema>

export const listModelsResponseSchema = z.object({
  models: z.array(modelEntrySchema),
  // The caller's resolution chain: the org root first, then the platform one.
  roots: z.array(z.string()).default([]),
})
export const modelResponseSchema = z.object({ model: modelDetailSchema })
export const modelEntryResponseSchema = z.object({ model: modelEntrySchema })
export const modelDownloadResponseSchema = z.object({
  model: z.string(),
  files: z.record(z.string(), z.string()),
  expiresInSeconds: z.number(),
  localPath: z.string(),
})
export type ModelDownload = z.infer<typeof modelDownloadResponseSchema>

export interface ModelsListParams {
  family?: string
  scope?: ModelScope
  includeArchived?: boolean
}

/** `name` or `name@version`: what a node's `model` config carries. */
export function modelRef(name: string, version?: number | null): string {
  return version ? `${name}@${version}` : name
}

export function parseModelRef(ref: string): { name: string; version: number | null } {
  const at = ref.lastIndexOf("@")
  if (at <= 0) return { name: ref, version: null }
  const version = Number(ref.slice(at + 1))
  if (!Number.isInteger(version) || version < 1) return { name: ref, version: null }
  return { name: ref.slice(0, at), version }
}
