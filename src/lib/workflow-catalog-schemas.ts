import { z } from "zod"

// Zod schemas for the served node catalog WIRE FORMAT only (GET
// /workflow-catalog, backend src/workflows/catalog/serialize.ts). Individual
// node config schemas arrive as JSON Schema inside the payload and are never
// re-modelled here — that is the whole point of the served catalog: the palette,
// config forms, and edge validation always match what publish validation will
// accept. Frozen contract; see plans/workflow_refactor/STATUS.md.

export const CHANNELS = [
  "video",
  "frames",
  "telemetry",
  "json",
  "condition",
  "event",
] as const
export type Channel = (typeof CHANNELS)[number]

export const NODE_GROUPS = [
  "source",
  "video",
  "telemetry",
  "model",
  "logic",
  "output",
  "custom",
] as const
export type CatalogNodeGroup = (typeof NODE_GROUPS)[number]

export const catalogPortSchema = z.object({
  id: z.string(),
  label: z.string(),
  channel: z.enum(CHANNELS),
  // json ports only: what the port produces (outputs) / accepts (inputs).
  // An untagged json input accepts any json tag.
  tag: z.string().optional(),
  cardinality: z.enum(["one", "many"]),
  required: z.boolean(),
})
export type CatalogPort = z.infer<typeof catalogPortSchema>

export const capabilityRuleSchema = z.union([
  z.object({ token: z.string() }),
  z.object({ tokenTemplate: z.string() }),
])

export const catalogConstraintSchema = z.object({
  kind: z.literal("atLeastOneOf"),
  ports: z.array(z.string()),
})

export const catalogNodeSchema = z.object({
  type: z.string(),
  version: z.number(),
  group: z.enum(NODE_GROUPS),
  label: z.string(),
  description: z.string(),
  ui: z.object({
    icon: z.string(),
    editor: z.enum(["prompt", "geofence", "expression"]).optional(),
  }),
  inputs: z.array(catalogPortSchema),
  outputs: z.array(catalogPortSchema),
  // JSON Schema draft-07 for the node config; rendered by the config form.
  configSchema: z.record(z.string(), z.unknown()),
  // Result of parsing {} server-side ({} when the config has required fields).
  configDefaults: z.record(z.string(), z.unknown()),
  requires: z.array(capabilityRuleSchema),
  runtime: z.object({
    target: z.enum(["any", "media"]),
    gpuPreferred: z.boolean().optional(),
    modelRef: z.object({ family: z.string() }).optional(),
  }),
  constraints: z.array(catalogConstraintSchema).optional(),
})
export type CatalogNode = z.infer<typeof catalogNodeSchema>

export const workflowCatalogSchema = z.object({
  catalogVersion: z.string(),
  schemaVersion: z.number(),
  // PoC v1 node type -> catalog type (the backend upgrades stored definitions
  // on read; this map lets the JSON view accept hand-pasted v1 types too).
  aliases: z.record(z.string(), z.string()),
  nodes: z.array(catalogNodeSchema),
})
export type WorkflowCatalog = z.infer<typeof workflowCatalogSchema>

// --- Edge typing ---------------------------------------------------------------

/** True iff an edge from output port `out` may enter input port `inp`. */
export function channelsCompatible(out: CatalogPort, inp: CatalogPort): boolean {
  if (out.channel !== inp.channel) return false
  if (inp.channel === "json" && inp.tag !== undefined) return out.tag === inp.tag
  return true
}

/** Display label for a port's channel, e.g. "json:detections". */
export function channelLabel(port: CatalogPort): string {
  return port.channel === "json" && port.tag ? `json:${port.tag}` : port.channel
}

// --- Publish validation issues ---------------------------------------------------
// Wire shape of the publish 400: { error: { code: "WORKFLOW_VALIDATION_FAILED",
// message, details: { issues: [...] } } }. `ApiError.message` carries the raw
// response body, so this parses that text.

export const publishIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  nodeId: z.string().optional(),
  edgeId: z.string().optional(),
  portId: z.string().optional(),
})
export type PublishIssue = z.infer<typeof publishIssueSchema>

const publishErrorBodySchema = z.object({
  error: z.object({
    code: z.literal("WORKFLOW_VALIDATION_FAILED"),
    message: z.string(),
    details: z.object({ issues: z.array(publishIssueSchema) }),
  }),
})

/** Publish-validation issues out of an error body, or null for other errors. */
export function parsePublishIssues(bodyText: string): PublishIssue[] | null {
  try {
    const parsed = publishErrorBodySchema.safeParse(JSON.parse(bodyText))
    return parsed.success ? parsed.data.error.details.issues : null
  } catch {
    return null
  }
}
