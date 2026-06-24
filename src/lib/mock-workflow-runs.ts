import { MOCK_TEMPLATES } from "./mock-workflows"
import { NODE_CATALOG_BY_TYPE } from "./workflow-nodes"
import type { WorkflowDefinition } from "./workflow-schemas"
import type {
  RunEvent,
  RunStep,
  WorkflowRunDetail,
} from "./workflow-run-schemas"

// Dummy runs for the Workflow Instances mockup. Graph snapshots are pulled from
// the existing template versions so a run's "Pipeline trace" renders the real
// shape. The in-memory shim (`workflow-instances-api.ts`) reads this; list rows
// are derived from these details.

function definitionOf(templateId: string, version: number): WorkflowDefinition {
  const template = MOCK_TEMPLATES.find((t) => t.id === templateId)
  const found = template?.versions.find((v) => v.version === version)
  if (!found) throw new Error(`No definition for ${templateId} v${version}`)
  return structuredClone(found.definition)
}

// Per-node sample output, keyed by catalog type (same spirit as the simulator).
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
      return "37 detections"
    case "processor.speed_from_gps":
      return "peak decel -0.52 g"
    case "processor.imu_decel":
      return "spike -0.61 g"
    case "processor.sensor_fusion":
      return "aligned 3 streams"
    case "logic.threshold":
      return "crossed 2×"
    case "logic.composite_rule":
      return "matched 2 windows"
    case "output.event":
      return "emitted events"
    case "output.alert":
      return "raised alert"
    default:
      return "ok"
  }
}

function buildSteps(
  definition: WorkflowDefinition,
  opts: { failNodeId?: string; failOutput?: string; runningTail?: number } = {},
): RunStep[] {
  let failed = false
  const total = definition.nodes.length
  return definition.nodes.map((node, i) => {
    const label = NODE_CATALOG_BY_TYPE[node.type]?.label ?? node.data.label
    if (opts.failNodeId && node.id === opts.failNodeId) {
      failed = true
      return {
        nodeId: node.id,
        label,
        status: "failed",
        output: opts.failOutput ?? "error",
        durationMs: 200 + i * 120,
      }
    }
    if (failed) {
      return { nodeId: node.id, label, status: "skipped", output: "—", durationMs: 0 }
    }
    if (opts.runningTail && i >= total - opts.runningTail) {
      return { nodeId: node.id, label, status: "skipped", output: "pending…", durationMs: 0 }
    }
    return {
      nodeId: node.id,
      label,
      status: "ok",
      output: sampleOutput(node.type),
      durationMs: 200 + i * 120,
    }
  })
}

let eventSeq = 0
function evt(
  kind: string,
  occurredAt: string,
  confidence: number,
  payloadSummary: string,
): RunEvent {
  eventSeq += 1
  return { id: `evt-${eventSeq}`, kind, occurredAt, confidence, clip: true, payloadSummary }
}

interface RunArgs {
  id: string
  templateId: string
  templateName: string
  templateVersion: number
  deviceId: string
  deviceName: string
  projectId: string
  projectName: string
  trigger: WorkflowRunDetail["trigger"]
  status: WorkflowRunDetail["status"]
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  triggeredBy: string
  metrics: Record<string, number | string>
  events?: RunEvent[]
  failNodeId?: string
  failOutput?: string
  error?: string
  runningTail?: number
}

function makeRun(args: RunArgs): WorkflowRunDetail {
  const definition = definitionOf(args.templateId, args.templateVersion)
  const events = args.events ?? []
  return {
    id: args.id,
    projectId: args.projectId,
    templateId: args.templateId,
    templateName: args.templateName,
    templateVersion: args.templateVersion,
    deviceId: args.deviceId,
    deviceName: args.deviceName,
    trigger: args.trigger,
    status: args.status,
    startedAt: args.startedAt,
    endedAt: args.endedAt,
    durationMs: args.durationMs,
    eventCount: events.length,
    projectName: args.projectName,
    triggeredBy: args.triggeredBy,
    definition,
    steps: buildSteps(definition, {
      failNodeId: args.failNodeId,
      failOutput: args.failOutput,
      runningTail: args.runningTail,
    }),
    events,
    metrics: args.metrics,
    error: args.error ?? null,
    failedNodeId: args.failNodeId ?? null,
  }
}

const HARSH = {
  templateId: "wft-harsh-driving",
  templateName: "Harsh Driving — Sudden Stop",
  templateVersion: 3,
} as const
const PERIMETER = {
  templateId: "wft-perimeter",
  templateName: "Perimeter Person Detect",
  templateVersion: 2,
} as const

export const MOCK_RUNS: WorkflowRunDetail[] = [
  makeRun({
    ...HARSH,
    id: "wfr-1001",
    deviceId: "dev-22198",
    deviceName: "DV-22198",
    projectId: "proj-fleet",
    projectName: "Fleet Safety Pilot",
    trigger: "event",
    status: "succeeded",
    startedAt: "2026-06-24T05:10:00.000Z",
    endedAt: "2026-06-24T05:10:42.000Z",
    durationMs: 42000,
    triggeredBy: "City fleet — safety",
    metrics: { framesProcessed: 284, avgLatencyMs: 38, eventsEmitted: 2, cost: "$0.004" },
    events: [
      evt("harsh_brake", "00:41", 0.87, "decel -0.61 g, speed 38→6 km/h"),
      evt("harsh_brake", "02:13", 0.79, "decel -0.48 g, speed 44→12 km/h"),
    ],
  }),
  makeRun({
    ...PERIMETER,
    id: "wfr-1002",
    deviceId: "dev-yc0007",
    deviceName: "YC-0007",
    projectId: "proj-fleet",
    projectName: "Site Security",
    trigger: "schedule",
    status: "running",
    startedAt: "2026-06-24T07:14:00.000Z",
    endedAt: null,
    durationMs: null,
    triggeredBy: "Yard cameras",
    metrics: { framesProcessed: 120, avgLatencyMs: 41 },
    runningTail: 2,
  }),
  makeRun({
    ...HARSH,
    id: "wfr-1003",
    deviceId: "dev-22311",
    deviceName: "DV-22311",
    projectId: "proj-fleet",
    projectName: "Fleet Safety Pilot",
    trigger: "manual",
    status: "failed",
    startedAt: "2026-06-24T02:00:00.000Z",
    endedAt: "2026-06-24T02:00:12.000Z",
    durationMs: 12000,
    triggeredBy: "Driver coaching beta",
    metrics: { framesProcessed: 96, avgLatencyMs: 52 },
    failNodeId: "n-rule",
    failOutput: "evaluation error: null speed input",
    error: "Harsh Event Rule: evaluation error (null speed input)",
  }),
  makeRun({
    ...PERIMETER,
    id: "wfr-1004",
    deviceId: "dev-yc0007",
    deviceName: "YC-0007",
    projectId: "proj-fleet",
    projectName: "Site Security",
    trigger: "event",
    status: "succeeded",
    startedAt: "2026-06-23T09:30:00.000Z",
    endedAt: "2026-06-23T09:30:31.000Z",
    durationMs: 31000,
    triggeredBy: "Yard cameras",
    metrics: { framesProcessed: 210, avgLatencyMs: 44, eventsEmitted: 1, cost: "$0.003" },
    events: [evt("person_at_perimeter", "01:08", 0.91, "1 person, zone B, 4.2s dwell")],
  }),
  makeRun({
    ...HARSH,
    id: "wfr-1005",
    deviceId: "dev-22198",
    deviceName: "DV-22198",
    projectId: "proj-fleet",
    projectName: "Fleet Safety Pilot",
    trigger: "schedule",
    status: "succeeded",
    startedAt: "2026-06-24T04:05:00.000Z",
    endedAt: "2026-06-24T04:05:40.000Z",
    durationMs: 40000,
    triggeredBy: "City fleet — safety",
    metrics: { framesProcessed: 268, avgLatencyMs: 36, eventsEmitted: 0, cost: "$0.004" },
  }),
  makeRun({
    ...HARSH,
    id: "wfr-1006",
    deviceId: "dev-22401",
    deviceName: "DV-22401",
    projectId: "proj-fleet",
    projectName: "Fleet Safety Pilot",
    trigger: "event",
    status: "succeeded",
    startedAt: "2026-06-24T01:20:00.000Z",
    endedAt: "2026-06-24T01:20:45.000Z",
    durationMs: 45000,
    triggeredBy: "Insurance telematics",
    metrics: { framesProcessed: 301, avgLatencyMs: 39, eventsEmitted: 3, cost: "$0.005" },
    events: [
      evt("harsh_brake", "00:22", 0.83, "decel -0.55 g"),
      evt("harsh_brake", "01:47", 0.76, "decel -0.45 g"),
      evt("harsh_brake", "03:05", 0.81, "decel -0.51 g"),
    ],
  }),
  makeRun({
    ...PERIMETER,
    id: "wfr-1007",
    deviceId: "dev-yc0012",
    deviceName: "YC-0012",
    projectId: "proj-fleet",
    projectName: "Site Security",
    trigger: "manual",
    status: "failed",
    startedAt: "2026-06-22T18:00:00.000Z",
    endedAt: "2026-06-22T18:00:08.000Z",
    durationMs: 8000,
    triggeredBy: "Yard cameras",
    metrics: { framesProcessed: 0 },
    failNodeId: "n-decode",
    failOutput: "stream unavailable (KVS black-hole)",
    error: "Decode & Sample: video stream unavailable",
  }),
]
