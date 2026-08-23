import { xg } from "@/lib/xorgate"
import {
  createSimulationUpload,
  uploadFileToS3,
} from "@/lib/workflow-templates-api"
import type { SimulationApiBinding } from "@/lib/workflow-sim-schemas"
import type { WorkflowDefinition } from "@/lib/workflow-schemas"
import { useWorkflowCatalog } from "@/store/workflow-catalog"
import type { SourceBinding } from "./simulator-types"

// Maps the panel's UI bindings onto the frozen simulations API union, doing the
// async legwork each kind needs: files go through the presigned-POST upload
// flow (key cached back onto the binding for tweak-and-rerun cycles), and
// "last N readings" device picks resolve to the explicit from/to window the
// API requires by asking the telemetry API what time range those N cover.

// Frozen server-side caps (content-length-range on the presigned POST). Checked
// client-side first for a friendly per-row error instead of an S3 XML reply.
export const SIM_UPLOAD_MAX_BYTES = {
  video: 1024 * 1024 * 1024, // 1 GiB
  csv: 25 * 1024 * 1024, // 25 MiB
} as const

/** A per-source-row problem the panel renders next to the row. */
export class BindingResolveError extends Error {
  nodeId: string
  constructor(nodeId: string, message: string) {
    super(message)
    this.name = "BindingResolveError"
    this.nodeId = nodeId
  }
}

export interface ResolvedBindings {
  api: Record<string, SimulationApiBinding>
  // uploadKey per nodeId for freshly uploaded files, so the panel can cache
  // them onto its binding state.
  uploadedKeys: Record<string, string>
}

function formatMax(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024
    ? `${bytes / (1024 * 1024 * 1024)} GiB`
    : `${bytes / (1024 * 1024)} MiB`
}

async function uploadBoundFile(
  templateId: string,
  nodeId: string,
  kind: "video" | "csv",
  file: File,
): Promise<string> {
  if (file.size > SIM_UPLOAD_MAX_BYTES[kind]) {
    throw new BindingResolveError(
      nodeId,
      `"${file.name}" is too large (max ${formatMax(SIM_UPLOAD_MAX_BYTES[kind])})`,
    )
  }
  const upload = await createSimulationUpload(templateId, {
    kind,
    filename: file.name,
    contentType: file.type || undefined,
  })
  if (file.size > upload.maxBytes) {
    throw new BindingResolveError(
      nodeId,
      `"${file.name}" is too large (max ${formatMax(upload.maxBytes)})`,
    )
  }
  await uploadFileToS3(upload, file)
  return upload.key
}

// A datetime-local value has no zone; interpret it in the browser's zone.
function localToIso(value: string, nodeId: string, label: string): string {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) {
    throw new BindingResolveError(nodeId, `Invalid ${label} timestamp`)
  }
  return new Date(ms).toISOString()
}

// Resolve a "last N readings" pick into the explicit window the API needs:
// the time range covered by the device's most recent N samples, padded by a
// second on each side so boundary samples survive the window filter.
async function lastNWindow(
  nodeId: string,
  deviceId: string,
  n: number,
): Promise<{ from: string; to: string }> {
  const { readings } = await xg().telemetry.recent(deviceId, { limit: n })
  if (readings.length === 0) {
    throw new BindingResolveError(
      nodeId,
      "The device has no stored telemetry to simulate over",
    )
  }
  const first = Date.parse(readings[0].ts)
  const last = Date.parse(readings[readings.length - 1].ts)
  return {
    from: new Date(Math.min(first, last) - 1000).toISOString(),
    to: new Date(Math.max(first, last) + 1000).toISOString(),
  }
}

/**
 * Resolves every UI binding to its API form. Uploads run sequentially (one
 * progress message at a time is plenty for a demo panel); the first failure
 * aborts with a BindingResolveError carrying the offending nodeId.
 */
export async function resolveApiBindings(
  templateId: string,
  bindings: Record<string, SourceBinding>,
  onProgress?: (message: string) => void,
): Promise<ResolvedBindings> {
  const api: Record<string, SimulationApiBinding> = {}
  const uploadedKeys: Record<string, string> = {}

  for (const [nodeId, binding] of Object.entries(bindings)) {
    switch (binding.kind) {
      case "video-file": {
        let key = binding.uploadKey
        if (!key) {
          onProgress?.(`Uploading ${binding.name}…`)
          key = await uploadBoundFile(templateId, nodeId, "video", binding.file)
          uploadedKeys[nodeId] = key
        }
        api[nodeId] = { kind: "video_file", uploadKey: key }
        break
      }
      case "csv-file": {
        let key = binding.uploadKey
        if (!key) {
          onProgress?.(`Uploading ${binding.name}…`)
          key = await uploadBoundFile(templateId, nodeId, "csv", binding.file)
          uploadedKeys[nodeId] = key
        }
        api[nodeId] = { kind: "telemetry_csv", uploadKey: key }
        break
      }
      case "video-session":
        // The backend resolves the session to its ordered segment list and
        // feeds the engine the same per-segment binding a triggered run gets.
        api[nodeId] = { kind: "session", sessionId: binding.session.id }
        break
      case "device-telemetry": {
        const w = binding.window ?? { mode: "lastN" as const, n: 100 }
        const window =
          w.mode === "range"
            ? {
                from: localToIso(w.from, nodeId, "from"),
                to: localToIso(w.to, nodeId, "to"),
              }
            : await lastNWindow(nodeId, binding.deviceId, w.n)
        api[nodeId] = {
          kind: "device_telemetry",
          deviceId: binding.deviceId,
          window,
        }
        break
      }
      case "video-webcam":
        // The capture publisher starts once the run is live (use-webcam-ingest);
        // the API binding just declares the live ingest plane for this node.
        api[nodeId] = { kind: "webcam" }
        break
      case "video-live":
        throw new BindingResolveError(
          nodeId,
          "Live device streams need device-side frame publishing (not yet enabled); bind a file, an on-device session, or the webcam",
        )
    }
  }

  return { api, uploadedKeys }
}

// --- Simulation-only definition shaping -------------------------------------------

// The auto-attached Data Capture nodes get a recognizable id prefix so the
// results view can find their record artifacts (and readers of the run detail
// can tell them apart from user-placed nodes).
export const SIM_CAPTURE_PREFIX = "simcap-"

/**
 * Guarantees a full detections record set for the client-side overlay (open
 * question Q2): for every node with a json:detections output that no Data
 * Capture node consumes, append a Data Capture node + edge to the POSTed
 * definition. The records topic is throttled to live pace, so batch overlays
 * must replay the post-run artifact; without a capture node there is none.
 * The editor's canvas is untouched: this shapes only the definition sent to
 * the simulations API (the run detail's snapshot shows the extra node, labeled
 * as simulator-added).
 */
export function withSimulationCaptures(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  const byType = useWorkflowCatalog.getState().byType
  const detectionSources: { nodeId: string; portId: string; x: number; y: number }[] = []
  for (const node of definition.nodes) {
    const entry = byType[node.type]
    if (!entry) continue
    for (const port of entry.outputs) {
      if (port.channel === "json" && port.tag === "detections") {
        detectionSources.push({
          nodeId: node.id,
          portId: port.id,
          x: node.position.x,
          y: node.position.y,
        })
      }
    }
  }
  if (detectionSources.length === 0) return definition

  const captureTargets = new Set(
    definition.edges
      .filter((e) => {
        const target = definition.nodes.find((n) => n.id === e.target)
        return target?.type === "output.data_capture"
      })
      .map((e) => e.source),
  )
  const missing = detectionSources.filter((s) => !captureTargets.has(s.nodeId))
  if (missing.length === 0) return definition

  const captureDefaults =
    byType["output.data_capture"]?.configDefaults ?? { format: "jsonl" }
  return {
    ...definition,
    nodes: [
      ...definition.nodes,
      ...missing.map((s) => ({
        id: `${SIM_CAPTURE_PREFIX}${s.nodeId}`,
        type: "output.data_capture",
        position: { x: s.x + 280, y: s.y + 120 },
        data: {
          label: "Detections (simulator)",
          config: { ...captureDefaults },
        },
      })),
    ],
    edges: [
      ...definition.edges,
      ...missing.map((s) => ({
        id: `${SIM_CAPTURE_PREFIX}e-${s.nodeId}`,
        source: s.nodeId,
        sourceHandle: s.portId,
        target: `${SIM_CAPTURE_PREFIX}${s.nodeId}`,
        targetHandle: "records",
      })),
    ],
  }
}
