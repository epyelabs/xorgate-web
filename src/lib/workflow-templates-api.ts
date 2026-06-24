import { MOCK_CURRENT_USER, MOCK_TEMPLATES } from "./mock-workflows"
import { NODE_CATALOG_BY_TYPE } from "./workflow-nodes"
import type {
  SimulationResult,
  WorkflowDefinition,
  WorkflowTemplateDetail,
  WorkflowTemplateSummary,
  WorkflowTemplateVersion,
} from "./workflow-schemas"

// In-memory mock backend for Workflow Templates. Every exported function mirrors
// the signature the real client in `lib/api.ts` will expose, so going live means
// replacing these bodies with `apiRequest(...)` calls — nothing else changes.
//
// State is a mutable clone of the fixtures so edits (save / publish / restore)
// persist across navigation within a session. Reads return deep clones so the UI
// can never mutate the store by reference.

const db: WorkflowTemplateDetail[] = structuredClone(MOCK_TEMPLATES)

const delay = (ms = 220) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function clone<T>(value: T): T {
  return structuredClone(value)
}

function nowIso(): string {
  return new Date().toISOString()
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

function find(id: string): WorkflowTemplateDetail {
  const template = db.find((t) => t.id === id)
  if (!template) throw new Error(`Workflow template not found: ${id}`)
  return template
}

function toSummary(t: WorkflowTemplateDetail): WorkflowTemplateSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { versions: _versions, usage: _usage, ...summary } = t
  return clone(summary)
}

export async function listWorkflowTemplates(): Promise<{
  templates: WorkflowTemplateSummary[]
}> {
  await delay()
  return { templates: db.map(toSummary) }
}

export async function getWorkflowTemplate(
  id: string,
): Promise<{ template: WorkflowTemplateDetail }> {
  await delay()
  return { template: clone(find(id)) }
}

export async function createWorkflowTemplate(input: {
  name: string
  description?: string
}): Promise<{ template: WorkflowTemplateDetail }> {
  await delay()
  const ts = nowIso()
  const template: WorkflowTemplateDetail = {
    id: uid("wft"),
    name: input.name,
    slug: input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, ""),
    description: input.description?.trim() ? input.description.trim() : null,
    status: "draft",
    currentVersion: 1,
    publishedVersion: null,
    usedBy: 0,
    createdBy: MOCK_CURRENT_USER,
    updatedBy: MOCK_CURRENT_USER,
    createdAt: ts,
    updatedAt: ts,
    versions: [
      {
        id: uid("wftv"),
        version: 1,
        status: "draft",
        message: "Initial draft.",
        definition: { nodes: [], edges: [] },
        createdBy: MOCK_CURRENT_USER,
        createdAt: ts,
      },
    ],
    usage: [],
  }
  db.unshift(template)
  return { template: clone(template) }
}

export async function updateWorkflowTemplate(
  id: string,
  updates: { name?: string; description?: string | null },
): Promise<{ template: WorkflowTemplateDetail }> {
  await delay()
  const template = find(id)
  if (updates.name !== undefined) template.name = updates.name
  if (updates.description !== undefined) template.description = updates.description
  template.updatedBy = MOCK_CURRENT_USER
  template.updatedAt = nowIso()
  return { template: clone(template) }
}

// Saves the editor's working copy. Updates the existing open draft if there is
// one, otherwise opens a fresh draft version above the published one.
export async function saveDraftVersion(
  id: string,
  definition: WorkflowDefinition,
  message?: string,
): Promise<{ template: WorkflowTemplateDetail; version: WorkflowTemplateVersion }> {
  await delay()
  const template = find(id)
  const ts = nowIso()
  let draft = template.versions.find((v) => v.status === "draft")
  if (draft) {
    draft.definition = clone(definition)
    if (message !== undefined) draft.message = message
    draft.createdAt = ts
    draft.createdBy = MOCK_CURRENT_USER
  } else {
    const nextVersion = Math.max(...template.versions.map((v) => v.version), 0) + 1
    draft = {
      id: uid("wftv"),
      version: nextVersion,
      status: "draft",
      message: message ?? `Draft v${nextVersion}`,
      definition: clone(definition),
      createdBy: MOCK_CURRENT_USER,
      createdAt: ts,
    }
    template.versions.push(draft)
    template.currentVersion = nextVersion
  }
  template.updatedBy = MOCK_CURRENT_USER
  template.updatedAt = ts
  return { template: clone(template), version: clone(draft) }
}

// Promotes a version to "published": it becomes the live version, the previous
// published one is archived, and the template flips to published status.
export async function publishVersion(
  id: string,
  versionId: string,
): Promise<{ template: WorkflowTemplateDetail }> {
  await delay()
  const template = find(id)
  const target = template.versions.find((v) => v.id === versionId)
  if (!target) throw new Error(`Version not found: ${versionId}`)
  for (const v of template.versions) {
    if (v.status === "published") v.status = "archived"
  }
  target.status = "published"
  template.publishedVersion = target.version
  template.currentVersion = target.version
  template.status = "published"
  template.updatedBy = MOCK_CURRENT_USER
  template.updatedAt = nowIso()
  return { template: clone(template) }
}

// Opens a new draft seeded from an older version's definition.
export async function restoreVersion(
  id: string,
  versionId: string,
): Promise<{ template: WorkflowTemplateDetail; version: WorkflowTemplateVersion }> {
  await delay()
  const template = find(id)
  const source = template.versions.find((v) => v.id === versionId)
  if (!source) throw new Error(`Version not found: ${versionId}`)
  // An existing open draft is replaced by the restored content.
  template.versions = template.versions.filter((v) => v.status !== "draft")
  const nextVersion = Math.max(...template.versions.map((v) => v.version), 0) + 1
  const draft: WorkflowTemplateVersion = {
    id: uid("wftv"),
    version: nextVersion,
    status: "draft",
    message: `Restored from v${source.version}`,
    definition: clone(source.definition),
    createdBy: MOCK_CURRENT_USER,
    createdAt: nowIso(),
  }
  template.versions.push(draft)
  template.currentVersion = nextVersion
  template.updatedBy = MOCK_CURRENT_USER
  template.updatedAt = nowIso()
  return { template: clone(template), version: clone(draft) }
}

export async function listUsage(id: string) {
  await delay()
  return { instances: clone(find(id).usage) }
}

// Canned sample inputs the simulator can run against.
export const SIMULATION_FIXTURES = [
  { id: "urban-hard-stops", label: "Urban drive — 3 hard stops" },
  { id: "highway-clear", label: "Highway cruise — no events" },
  { id: "yard-intrusion", label: "Yard camera — 1 intrusion" },
] as const

function sampleOutput(catalogType: string): string {
  switch (catalogType) {
    case "source.video":
      return "1280×720 @ 30fps, 142 frames"
    case "source.gps":
      return "412 fixes, 8 sats avg"
    case "source.imu":
      return "412 samples @ 100Hz"
    case "source.telemetry":
      return "412 readings"
    case "processor.decode_sample":
      return "284 sampled frames"
    case "processor.object_detection":
      return "37 detections (vehicle, person)"
    case "processor.speed_from_gps":
      return "peak decel -0.52 g"
    case "processor.imu_decel":
      return "spike -0.61 g @ 02:13"
    case "processor.sensor_fusion":
      return "aligned 3 streams"
    case "logic.threshold":
      return "crossed 2×"
    case "logic.composite_rule":
      return "matched 2 windows"
    case "output.event":
      return "emitted 2 events"
    case "output.alert":
      return "raised 1 alert"
    default:
      return "ok"
  }
}

// Crude topological-ish ordering: walk from source nodes outward along edges.
function orderNodes(def: WorkflowDefinition): WorkflowDefinition["nodes"] {
  const byId = new Map(def.nodes.map((n) => [n.id, n]))
  const indegree = new Map(def.nodes.map((n) => [n.id, 0]))
  for (const e of def.edges) indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1)
  const queue = def.nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id)
  const seen = new Set<string>()
  const ordered: WorkflowDefinition["nodes"] = []
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const n = byId.get(id)
    if (n) ordered.push(n)
    for (const e of def.edges) {
      if (e.source === id && !seen.has(e.target)) queue.push(e.target)
    }
  }
  // Append any nodes not reachable from a source (disconnected).
  for (const n of def.nodes) if (!seen.has(n.id)) ordered.push(n)
  return ordered
}

export async function simulate(
  _id: string,
  definition: WorkflowDefinition,
  fixtureId: string,
): Promise<SimulationResult> {
  await delay(120)
  const steps = orderNodes(definition).map((n) => ({
    nodeId: n.id,
    label: NODE_CATALOG_BY_TYPE[n.type]?.label ?? n.data.label,
    output: sampleOutput(n.type),
  }))
  const emits = definition.nodes.filter((n) => n.type.startsWith("output."))
  const hasOutput = emits.length > 0
  let events: SimulationResult["events"] = []
  if (hasOutput && fixtureId === "urban-hard-stops") {
    events = [
      { kind: "harsh_brake", at: "00:41", confidence: 0.87 },
      { kind: "harsh_brake", at: "02:13", confidence: 0.79 },
    ]
  } else if (hasOutput && fixtureId === "yard-intrusion") {
    events = [{ kind: "person_at_perimeter", at: "01:08", confidence: 0.91 }]
  }
  return { steps, events }
}
