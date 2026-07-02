import { apiRequest } from "./api"
import { NODE_CATALOG_BY_TYPE } from "./workflow-nodes"
import type {
  SimulationResult,
  WorkflowDefinition,
  WorkflowDeployment,
  WorkflowTemplateDetail,
  WorkflowTemplateSummary,
  WorkflowTemplateVersion,
} from "./workflow-schemas"

// Real client for Workflow Templates (backend: workflow-templates.ts). Every
// function's signature is unchanged from the former in-memory mock, so the pages
// that consume it needed no edits; list/detail responses are still validated by
// the same `.safeParse()` pattern in the routes.

export async function listWorkflowTemplates(): Promise<{
  templates: WorkflowTemplateSummary[]
}> {
  return apiRequest("/workflow-templates")
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

// --- Simulation (client-side mock, v1) ---------------------------------------
// The simulator stays a local mock in v1 (no server route — see plan §6.1). Its
// output is clearly labelled "simulated" in the panel UI.
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
    case "processor.speed_limit_check":
      return "over limit 2× (peak +14 kph)"
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
  await new Promise<void>((resolve) => setTimeout(resolve, 120))
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
