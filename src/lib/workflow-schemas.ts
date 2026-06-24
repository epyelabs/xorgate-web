import { z } from "zod"

// Zod schemas + inferred types for the Workflow Templates feature. These mirror
// the shapes the real backend will return (see the API CRUD plan), so swapping
// the mock client in `workflow-templates-api.ts` for `apiRequest` later is a
// drop-in change validated by the same `.safeParse()` pattern used elsewhere.

// --- Graph definition (react-flow native) ------------------------------------
// `node.type` holds the catalog type (e.g. "processor.speed_from_gps"); config
// is intentionally loose (jsonb on the server) so node schemas can evolve.
export const workflowNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.object({
    label: z.string(),
    config: z.record(z.string(), z.unknown()).default({}),
  }),
})

export const workflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullish(),
  targetHandle: z.string().nullish(),
})

export const workflowDefinitionSchema = z.object({
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
})

// --- Template / version / instance -------------------------------------------
export const templateStatusSchema = z.enum(["draft", "published"])
export const versionStatusSchema = z.enum(["draft", "published", "archived"])

export const authorSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
})

export const workflowTemplateVersionSchema = z.object({
  id: z.string(),
  version: z.number(),
  status: versionStatusSchema,
  message: z.string().nullable(),
  definition: workflowDefinitionSchema,
  createdBy: authorSchema,
  createdAt: z.string(),
})

export const workflowInstanceSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectName: z.string(),
  target: z.string(),
  pinnedVersion: z.number().nullable(), // null => follows the published version
  enabled: z.boolean(),
  lastRunAt: z.string().nullable(),
})

// List-row summary: enough to render the table without the heavy definition.
export const workflowTemplateSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  status: templateStatusSchema,
  currentVersion: z.number(),
  publishedVersion: z.number().nullable(),
  usedBy: z.number(),
  createdBy: authorSchema,
  updatedBy: authorSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

// Detail = summary plus the full version history and usage list.
export const workflowTemplateDetailSchema = workflowTemplateSummarySchema.extend({
  versions: z.array(workflowTemplateVersionSchema),
  usage: z.array(workflowInstanceSchema),
})

export const listWorkflowTemplatesResponseSchema = z.object({
  templates: z.array(workflowTemplateSummarySchema),
})

export const getWorkflowTemplateResponseSchema = z.object({
  template: workflowTemplateDetailSchema,
})

export const createWorkflowTemplateSchema = z.object({
  name: z.string().min(1, "Name is required").max(80, "Name is too long"),
  description: z.string().max(280, "Description is too long").optional(),
})

// --- Simulation (mocked client-side this pass) --------------------------------
export const simulationStepSchema = z.object({
  nodeId: z.string(),
  label: z.string(),
  output: z.string(),
})

export const simulationEventSchema = z.object({
  kind: z.string(),
  at: z.string(),
  confidence: z.number(),
})

export const simulationResultSchema = z.object({
  steps: z.array(simulationStepSchema),
  events: z.array(simulationEventSchema),
})

export type WorkflowNodeDef = z.infer<typeof workflowNodeSchema>
export type WorkflowEdgeDef = z.infer<typeof workflowEdgeSchema>
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>
export type TemplateStatus = z.infer<typeof templateStatusSchema>
export type VersionStatus = z.infer<typeof versionStatusSchema>
export type Author = z.infer<typeof authorSchema>
export type WorkflowTemplateVersion = z.infer<typeof workflowTemplateVersionSchema>
export type WorkflowInstance = z.infer<typeof workflowInstanceSchema>
export type WorkflowTemplateSummary = z.infer<typeof workflowTemplateSummarySchema>
export type WorkflowTemplateDetail = z.infer<typeof workflowTemplateDetailSchema>
export type CreateWorkflowTemplateInput = z.infer<typeof createWorkflowTemplateSchema>
export type SimulationStep = z.infer<typeof simulationStepSchema>
export type SimulationEvent = z.infer<typeof simulationEventSchema>
export type SimulationResult = z.infer<typeof simulationResultSchema>
