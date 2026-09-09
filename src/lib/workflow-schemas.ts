import { z } from "zod"
import { pageSchema } from "./schemas"

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
  // Absent = v1 (PoC node types); 2 = catalog node types. The backend upgrades
  // v1 on read, and this editor stamps 2 on save (flowToDefinition).
  schemaVersion: z.number().int().optional(),
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

// A deployment: a template attached to / tuned onto devices in a workspace (the
// template "Usage" tab). Distinct from a WorkflowRun (a single execution).
export const workflowDeploymentSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspaceName: z.string(),
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
  // Free-form labels, normalized server-side (lowercase, deduped, at most 20).
  // Default rather than required: an API deployment predating tags omits them.
  tags: z.array(z.string()).default([]),
  status: templateStatusSchema,
  currentVersion: z.number(),
  publishedVersion: z.number().nullable(),
  usedBy: z.number(),
  // Abstract input needs derived from the running version's graph — tokens like
  // "video", "gps", "imu", "metric:<key>". Used by the attach picker to flag
  // device incompatibility (the server enforces it authoritatively on attach).
  requiredCapabilities: z.array(z.string()).optional(),
  createdBy: authorSchema,
  updatedBy: authorSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

// Detail = summary plus the full version history and usage list.
export const workflowTemplateDetailSchema = workflowTemplateSummarySchema.extend({
  versions: z.array(workflowTemplateVersionSchema),
  usage: z.array(workflowDeploymentSchema),
})

export const listWorkflowTemplatesResponseSchema = z.object({
  templates: z.array(workflowTemplateSummarySchema),
  // Present on the standardized list endpoint; absent on older responses.
  page: pageSchema.optional(),
})

// Query params for the standardized workflow-templates list endpoint.
export interface WorkflowTemplatesListParams {
  limit?: number
  offset?: number
  order?: "asc" | "desc"
  sort?: "updatedAt" | "createdAt" | "name"
  status?: TemplateStatus
  // ANY-of: a template matches when it carries at least one of these. Sent as
  // one comma-separated `tag` parameter, which is the same request as repeating
  // the parameter (the API comma-joins duplicates either way).
  tags?: string[]
}

// `GET /workflow-templates/tags`: the org's vocabulary, most used first.
export const workflowTemplateTagsResponseSchema = z.object({
  tags: z.array(z.object({ tag: z.string(), count: z.number() })),
})

export type WorkflowTemplateTagCount = z.infer<
  typeof workflowTemplateTagsResponseSchema
>["tags"][number]

export const getWorkflowTemplateResponseSchema = z.object({
  template: workflowTemplateDetailSchema,
})

export const createWorkflowTemplateSchema = z.object({
  name: z.string().min(1, "Name is required").max(80, "Name is too long"),
  description: z.string().max(280, "Description is too long").optional(),
})

// The tag rules, mirrored from the backend's src/utils/tags.ts so the editor can
// refuse a value before a round trip. The server is still the authority.
export const TAG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
export const MAX_TAG_LENGTH = 32
export const MAX_TAGS_PER_TEMPLATE = 20

/** Canonical form of one typed tag, or null when it cannot be one. */
export function normalizeTag(raw: string): string | null {
  const tag = raw.trim().toLowerCase()
  if (tag.length === 0 || tag.length > MAX_TAG_LENGTH) return null
  return TAG_PATTERN.test(tag) ? tag : null
}

export type WorkflowNodeDef = z.infer<typeof workflowNodeSchema>
export type WorkflowEdgeDef = z.infer<typeof workflowEdgeSchema>
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>
export type TemplateStatus = z.infer<typeof templateStatusSchema>
export type VersionStatus = z.infer<typeof versionStatusSchema>
export type Author = z.infer<typeof authorSchema>
export type WorkflowTemplateVersion = z.infer<typeof workflowTemplateVersionSchema>
export type WorkflowDeployment = z.infer<typeof workflowDeploymentSchema>
export type WorkflowTemplateSummary = z.infer<typeof workflowTemplateSummarySchema>
export type WorkflowTemplateDetail = z.infer<typeof workflowTemplateDetailSchema>
export type CreateWorkflowTemplateInput = z.infer<typeof createWorkflowTemplateSchema>
