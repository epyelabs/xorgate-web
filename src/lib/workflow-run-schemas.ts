import { z } from "zod"
import { workflowDefinitionSchema } from "./workflow-schemas"
import { pageSchema } from "./schemas"

// Schemas + types for Workflow Instances (= workflow runs / executions),
// mirroring backend workflow-runs.ts. Since M3, runs carry a `mode`
// ("production" | "simulation"); device-less simulation runs have null
// workspace/device fields (migration 0015), and v2 engine runs expose their
// S3 artifacts map for Data Capture downloads via
// GET /workflow-runs/{id}/artifact-url.

// "cancelled": a run the user stopped (POST /workflow-runs/{id}/cancel); today
// only simulation runs can be cancelled. Terminal, like succeeded/failed.
export const runStatusSchema = z.enum([
  "running",
  "succeeded",
  "failed",
  "cancelled",
])
// Raw trigger value from the run row: telemetry_condition | session_completed |
// segment_uploaded |
// schedule | manual | simulation (open set server-side, so keep it a string).
export const runTriggerSchema = z.string()
export const runModeSchema = z.enum(["production", "simulation"])
export const runStepStatusSchema = z.enum(["ok", "failed", "skipped"])

// One node's execution in the run trace (mirrors a node in the definition).
export const runStepSchema = z.object({
  // ADDITIVE: topological order (absent on responses from older backends;
  // the trace falls back to array order).
  seq: z.number().optional(),
  nodeId: z.string(),
  label: z.string(),
  status: runStepStatusSchema,
  output: z.string(),
  durationMs: z.number(),
})

// A detection emitted by the run (from the `events` table).
export const runEventSchema = z.object({
  id: z.string(),
  kind: z.string(),
  occurredAt: z.string(),
  confidence: z.number(),
  clip: z.boolean(),
  // ADDITIVE: the evidence clip key (when `clip`) and the full event payload
  // (the row's jsonb; absent on responses from older backends).
  clipKey: z.string().nullable().optional(),
  payloadSummary: z.string(),
  payload: z.unknown().optional(),
  // ADDITIVE (webhooks P2, engine 0.5.0): the output.event node that emitted
  // it (null on runs from older engines), and, on SIMULATION runs only, the
  // node's `webhook` endpoint name (null when the node has none). Production
  // runs route by the node's name from `definition` instead.
  nodeId: z.string().nullable().optional(),
  wouldDeliverTo: z.string().nullable().optional(),
})

// Where a v2 run's S3 artifacts live (run detail `artifacts` column; null on
// PoC runs). Keys are fetchable via GET /workflow-runs/{id}/artifact-url.
// The MP4 the Fargate host muxes from one visualization node's annotated
// frames (`video/<nodeId>.mp4`; ADDITIVE, absent on Lambda and older runs).
export const runVideoArtifactSchema = z.object({
  key: z.string(),
  frames: z.number(),
  fps: z.number(),
})
export type RunVideoArtifact = z.infer<typeof runVideoArtifactSchema>

export const runArtifactsSchema = z.object({
  eventsKey: z.string().nullable(),
  outputs: z.record(
    z.string(),
    z.object({
      recordsKey: z.string(),
      count: z.number(),
      format: z.string(),
    }),
  ),
  videos: z.record(z.string(), runVideoArtifactSchema).optional(),
})
export type RunArtifacts = z.infer<typeof runArtifactsSchema>

// List-row summary: enough to render the table without the heavy trace.
// workspace/device fields are null on device-less simulation runs.
export const workflowRunSummarySchema = z.object({
  id: z.string(),
  workspaceId: z.string().nullable(),
  templateId: z.string(),
  templateName: z.string(),
  templateVersion: z.number(),
  deviceId: z.string().nullable(),
  deviceName: z.string().nullable(),
  trigger: runTriggerSchema,
  mode: runModeSchema,
  status: runStatusSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  eventCount: z.number(),
})

// Detail = summary plus the full trace, events, metrics and (snapshot) graph.
export const workflowRunDetailSchema = workflowRunSummarySchema.extend({
  workspaceName: z.string().nullable(),
  triggeredBy: z.string(), // the deployment/attachment name that fired this run
  definition: workflowDefinitionSchema, // the graph that actually ran
  steps: z.array(runStepSchema),
  events: z.array(runEventSchema),
  metrics: z.record(z.string(), z.union([z.number(), z.string()])),
  // v2 engine runs only (null on PoC runs).
  engineVersion: z.number().nullable(),
  artifacts: runArtifactsSchema.nullable(),
  error: z.string().nullable(),
  failedNodeId: z.string().nullable(),
  // ADDITIVE (M6): live-progress subscription hint for v2 runs — the M3
  // topic/payload contract under wf/run/<org>/<id> (production) or
  // wf/sim/<org>/<id> (simulation). Null on PoC-era rows; optional so the
  // schema also parses pre-M6 backend responses.
  progress: z.object({ topicPrefix: z.string() }).nullable().optional(),
})

export const listWorkflowRunsResponseSchema = z.object({
  runs: z.array(workflowRunSummarySchema),
  // Optional: present on the standardized list endpoints; absent on older /
  // unparameterized responses.
  page: pageSchema.optional(),
})

// Query params for the standardized workflow-runs list endpoints.
export interface WorkflowRunsListParams {
  limit?: number
  offset?: number
  order?: "asc" | "desc"
  status?: RunStatus
  from?: string
  to?: string
}

export const getWorkflowRunResponseSchema = z.object({
  run: workflowRunDetailSchema,
})

export type RunStatus = z.infer<typeof runStatusSchema>
export type RunTrigger = z.infer<typeof runTriggerSchema>
export type RunMode = z.infer<typeof runModeSchema>
export type RunStepStatus = z.infer<typeof runStepStatusSchema>
export type RunStep = z.infer<typeof runStepSchema>
export type RunEvent = z.infer<typeof runEventSchema>
export type WorkflowRunSummary = z.infer<typeof workflowRunSummarySchema>
export type WorkflowRunDetail = z.infer<typeof workflowRunDetailSchema>
