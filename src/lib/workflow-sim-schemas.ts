import { z } from "zod"
import { runStatusSchema } from "./workflow-run-schemas"

// Zod schemas for the simulator WIRE FORMAT only, mirroring the M3 session 1
// frozen contracts (see plans/workflow_refactor/STATUS.md):
//   - POST /workflow-templates/{id}/simulations request/response
//   - POST .../simulations/uploads response (S3 presigned POST)
//   - the five IoT progress topic payloads (source of truth: backend
//     src/workflows/engine/progress.ts)
//   - the json:detections channel payload (backend catalog/types.ts), which
//     drives the client-side box overlay (open question Q2)
// Pattern follows workflow-catalog-schemas.ts: one hand-written mirror of a
// frozen backend contract, never re-modelled per node.

// --- Simulation bindings (API union; FE -> BE) ---------------------------------

export const simulationBindingSchema = z.discriminatedUnion("kind", [
  // An on-device recording session: the backend resolves it to the ordered
  // segment list and feeds the engine the same per-segment binding a real
  // triggered run gets. (Replaced the cloud recorder's `recording` kind.)
  z.object({ kind: z.literal("session"), sessionId: z.string() }),
  z.object({ kind: z.literal("video_file"), uploadKey: z.string() }),
  z.object({
    kind: z.literal("device_telemetry"),
    deviceId: z.string(),
    window: z.object({ from: z.string(), to: z.string() }),
    metrics: z.array(z.string()).optional(),
  }),
  z.object({
    kind: z.literal("telemetry_csv"),
    uploadKey: z.string(),
    metrics: z.array(z.string()).optional(),
  }),
  // M5 live plane: the browser publishes sampled JPEG frames to
  // <topicPrefix>/ingest/<nodeId> while the run is live; nothing is uploaded.
  z.object({
    kind: z.literal("webcam"),
    maxDurationSeconds: z.number().optional(),
  }),
])
export type SimulationApiBinding = z.infer<typeof simulationBindingSchema>

// --- POST /workflow-templates/{id}/simulations response ------------------------

export const simulationRunSchema = z.object({
  id: z.string(),
  status: z.string(),
  mode: z.string(),
  startedAt: z.string(),
  templateId: z.string(),
  templateVersion: z.number(),
  engineTarget: z.enum(["lambda", "fargate"]),
  deviceId: z.string().nullable(),
  workspaceId: z.string().nullable(),
})

export const simulationProgressSchema = z.object({
  topicPrefix: z.string(),
  topics: z.object({
    status: z.string(),
    steps: z.string(),
    events: z.string(),
    previewPrefix: z.string(),
    recordsPrefix: z.string(),
  }),
})

export const createSimulationResponseSchema = z.object({
  run: simulationRunSchema,
  progress: simulationProgressSchema,
})
export type CreateSimulationResponse = z.infer<
  typeof createSimulationResponseSchema
>

// --- Saved simulation runs (per template + user) --------------------------------
// GET    /workflow-templates/{id}/simulations/saved          -> { saved: [] }
// POST   /workflow-templates/{id}/simulations/{runId}/save   -> { saved } (201 new, 200 upsert)
// DELETE /workflow-templates/{id}/simulations/saved/{savedId} -> 204
// A save is a bookmark on a terminal simulation run row for the CURRENT user;
// the run itself is re-read via GET /workflow-runs/{id} on Load. `bindings` is
// a display-only snapshot of the run's trigger bindings at save time.

export const savedSimulationRunSchema = z.object({
  id: z.string(),
  status: runStatusSchema,
  mode: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  templateVersion: z.number().nullable(),
  // The run row's executionMode ("lambda" | "fargate"); kept open (display only).
  engineTarget: z.string().nullable(),
  error: z.string().nullable(),
  eventCount: z.number(),
})

export const savedSimulationSchema = z.object({
  id: z.string(),
  templateId: z.string(),
  runId: z.string(),
  name: z.string(),
  bindings: z.unknown().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  run: savedSimulationRunSchema,
})
export type SavedSimulation = z.infer<typeof savedSimulationSchema>

export const listSavedSimulationsResponseSchema = z.object({
  saved: z.array(savedSimulationSchema),
})

export const saveSimulationResponseSchema = z.object({
  saved: savedSimulationSchema,
})

// --- POST .../simulations/uploads response --------------------------------------

export const simulationUploadSchema = z.object({
  key: z.string(),
  url: z.string(),
  fields: z.record(z.string(), z.string()),
  expiresInSeconds: z.number(),
  maxBytes: z.number(),
})
export type SimulationUpload = z.infer<typeof simulationUploadSchema>

export const createSimulationUploadResponseSchema = z.object({
  upload: simulationUploadSchema,
})

// --- Progress topic payloads (topicPrefix = wf/sim/<orgId>/<runId>) -------------
// Every payload carries runId and an `at` ISO timestamp. QoS 0, best-effort:
// treat these as the live view; the run detail row is the source of truth.

export const simStatusPayloadSchema = z.object({
  runId: z.string(),
  // "cancelled" is published best-effort by POST /workflow-runs/{id}/cancel.
  status: z.enum(["running", "succeeded", "failed", "cancelled"]),
  error: z.string().nullable(),
  failedNodeId: z.string().nullable(),
  at: z.string(),
})
export type SimStatusPayload = z.infer<typeof simStatusPayloadSchema>

export const simStepSchema = z.object({
  seq: z.number(),
  nodeId: z.string(),
  label: z.string(),
  status: z.enum(["ok", "failed", "skipped"]),
  output: z.string(),
  durationMs: z.number(),
})
export type SimStep = z.infer<typeof simStepSchema>

export const simStepPayloadSchema = z.object({
  runId: z.string(),
  step: simStepSchema,
  at: z.string(),
})
export type SimStepPayload = z.infer<typeof simStepPayloadSchema>

export const simEventSchema = z.object({
  kind: z.string(),
  occurredAt: z.string(),
  confidence: z.number(),
  payloadSummary: z.string(),
  payload: z.unknown().optional(),
})
export type SimEvent = z.infer<typeof simEventSchema>

export const simEventPayloadSchema = z.object({
  runId: z.string(),
  event: simEventSchema,
  at: z.string(),
})
export type SimEventPayload = z.infer<typeof simEventPayloadSchema>

export const simRecordPayloadSchema = z.object({
  runId: z.string(),
  nodeId: z.string(),
  port: z.string(),
  tag: z.string().optional(),
  ts: z.number(),
  seq: z.number(),
  payload: z.unknown(),
  at: z.string(),
})
export type SimRecordPayload = z.infer<typeof simRecordPayloadSchema>

export const simPreviewPayloadSchema = z.object({
  runId: z.string(),
  nodeId: z.string(),
  frameSeq: z.number(),
  width: z.number(),
  height: z.number(),
  jpegBase64: z.string(),
  at: z.string(),
})
export type SimPreviewPayload = z.infer<typeof simPreviewPayloadSchema>

// --- json:detections channel payload --------------------------------------------
// One message per decoded frame (empty boxes included); coordinates are source
// pixels (xyxy) against the given width/height. Captured to the Data Capture
// artifact as { ts, tag, record } lines.

export const detectionBoxSchema = z.object({
  cls: z.string(),
  confidence: z.number(),
  xyxy: z.tuple([z.number(), z.number(), z.number(), z.number()]),
})
export type DetectionBox = z.infer<typeof detectionBoxSchema>

export const detectionsPayloadSchema = z.object({
  ts: z.number(),
  frameSeq: z.number(),
  width: z.number(),
  height: z.number(),
  boxes: z.array(detectionBoxSchema),
})
export type DetectionsPayload = z.infer<typeof detectionsPayloadSchema>

// A Data Capture artifact line: { ts, tag, record }.
export const capturedRecordSchema = z.object({
  ts: z.number(),
  tag: z.string().nullable(),
  record: z.unknown(),
})

/**
 * Parses a Data Capture records artifact (jsonl or json array) into the
 * ts-ordered detection payloads it contains. Non-detection records (other
 * tags, unparseable lines) are skipped.
 */
export function parseDetectionRecords(text: string, format: string | undefined): DetectionsPayload[] {
  let rows: unknown[] = []
  if (format === "json") {
    try {
      const arr = JSON.parse(text)
      if (Array.isArray(arr)) rows = arr
    } catch {
      return []
    }
  } else {
    rows = text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        try {
          return JSON.parse(line) as unknown
        } catch {
          return null
        }
      })
  }
  const out: DetectionsPayload[] = []
  for (const row of rows) {
    const captured = capturedRecordSchema.safeParse(row)
    if (!captured.success) continue
    if (captured.data.tag !== null && captured.data.tag !== "detections") continue
    const det = detectionsPayloadSchema.safeParse(captured.data.record)
    if (det.success) out.push(det.data)
  }
  out.sort((a, b) => a.ts - b.ts)
  return out
}

// --- 400 SIMULATION_BINDING_INVALID ----------------------------------------------
// Wire shape: { error: { code, message, details: { issues: [{ nodeId?, message }] } } }.
// `ApiError.message` carries the raw response body (same as publish errors).

export const bindingIssueSchema = z.object({
  nodeId: z.string().optional(),
  message: z.string(),
})
export type SimulationBindingIssue = z.infer<typeof bindingIssueSchema>

const bindingErrorBodySchema = z.object({
  error: z.object({
    code: z.literal("SIMULATION_BINDING_INVALID"),
    message: z.string(),
    details: z.object({ issues: z.array(bindingIssueSchema) }),
  }),
})

/** Binding-validation issues out of an error body, or null for other errors. */
export function parseBindingIssues(bodyText: string): SimulationBindingIssue[] | null {
  try {
    const parsed = bindingErrorBodySchema.safeParse(JSON.parse(bodyText))
    return parsed.success ? parsed.data.error.details.issues : null
  } catch {
    return null
  }
}

// --- 502 SIMULATION_DISPATCH_FAILED ----------------------------------------------

const dispatchErrorBodySchema = z.object({
  error: z.object({
    code: z.literal("SIMULATION_DISPATCH_FAILED"),
    message: z.string(),
    details: z.object({ runId: z.string(), message: z.string() }),
  }),
})

/** Dispatch-failure details out of an error body, or null for other errors. */
export function parseDispatchFailure(
  bodyText: string,
): { runId: string; message: string } | null {
  try {
    const parsed = dispatchErrorBodySchema.safeParse(JSON.parse(bodyText))
    return parsed.success ? parsed.data.error.details : null
  } catch {
    return null
  }
}
