import { z } from "zod"
import { workflowDefinitionSchema } from "./workflow-schemas"
import { pageSchema } from "./schemas"

// Schemas + types for Workflow Instances (= workflow runs / executions). One row
// per execution of a workflow attached to a device, scoped to a workspace. These
// mirror the shapes the real `workflow_runs` + `events` backend will return, so
// swapping the mock client in `workflow-instances-api.ts` for `apiRequest` is a
// drop-in change validated by the same `.safeParse()` pattern.

export const runStatusSchema = z.enum(["running", "succeeded", "failed"])
export const runTriggerSchema = z.enum(["event", "schedule", "manual"])
export const runStepStatusSchema = z.enum(["ok", "failed", "skipped"])

// One node's execution in the run trace (mirrors a node in the definition).
export const runStepSchema = z.object({
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
  payloadSummary: z.string(),
})

// List-row summary: enough to render the table without the heavy trace.
export const workflowRunSummarySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  templateId: z.string(),
  templateName: z.string(),
  templateVersion: z.number(),
  deviceId: z.string(),
  deviceName: z.string(),
  trigger: runTriggerSchema,
  status: runStatusSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  eventCount: z.number(),
})

// Detail = summary plus the full trace, events, metrics and (snapshot) graph.
export const workflowRunDetailSchema = workflowRunSummarySchema.extend({
  workspaceName: z.string(),
  triggeredBy: z.string(), // the deployment/attachment name that fired this run
  definition: workflowDefinitionSchema, // the graph that actually ran
  steps: z.array(runStepSchema),
  events: z.array(runEventSchema),
  metrics: z.record(z.string(), z.union([z.number(), z.string()])),
  error: z.string().nullable(),
  failedNodeId: z.string().nullable(),
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
export type RunStepStatus = z.infer<typeof runStepStatusSchema>
export type RunStep = z.infer<typeof runStepSchema>
export type RunEvent = z.infer<typeof runEventSchema>
export type WorkflowRunSummary = z.infer<typeof workflowRunSummarySchema>
export type WorkflowRunDetail = z.infer<typeof workflowRunDetailSchema>
