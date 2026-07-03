import {
  Activity,
  Bell,
  Cpu,
  Gauge,
  GitBranch,
  type LucideIcon,
  MapPin,
  Radio,
  ScanEye,
  SlidersHorizontal,
  Video,
  Zap,
} from "lucide-react"
import type { Edge, Node } from "@xyflow/react"
import type { WorkflowDefinition } from "./workflow-schemas"

// The four lanes of a workflow graph. Sources emit raw device data, processors
// derive features from it, logic turns features into decisions, outputs publish
// the conclusion. The palette and node cards are colour-coded by group.
export type NodeGroup = "source" | "processor" | "logic" | "output"

// A single configurable knob on a node, rendered by the properties panel. Kept
// deliberately small (number / text / select) — this is a mockup catalog, the
// real per-node config schema will live server-side with the execution engine.
export interface NodeConfigField {
  key: string
  label: string
  type: "number" | "text" | "select"
  options?: string[]
  unit?: string
  default: string | number
}

export interface NodeCatalogEntry {
  type: string
  group: NodeGroup
  label: string
  description: string
  icon: LucideIcon
  fields: NodeConfigField[]
}

// Starter catalog seeded from the "Harsh Driving — Sudden Stop" example: decode
// & sample video, detect objects, derive speed from GPS, watch IMU deceleration,
// combine into a rule, emit an event. Extend freely — the editor is data-driven.
export const NODE_CATALOG: NodeCatalogEntry[] = [
  // --- Sources ---
  {
    type: "source.video",
    group: "source",
    // Abstract input: the template just declares "this workflow needs video".
    // The concrete stream is bound per device at attach time via the
    // recording_saved trigger's streamKeys — never on the template. (Named
    // multi-video/stereo binding is deferred; v1 feeds the triggering recording
    // to every video node.)
    label: "Video Stream",
    description:
      "H.264 camera feed. The device + channel are chosen when you attach this workflow (recording trigger), not here.",
    icon: Video,
    fields: [],
  },
  {
    type: "source.gps",
    group: "source",
    label: "GPS",
    description: "Position, speed and fix quality from the GNSS module.",
    icon: MapPin,
    fields: [],
  },
  {
    type: "source.imu",
    group: "source",
    label: "IMU",
    description: "Accelerometer / gyroscope (quaternion + linear acceleration).",
    icon: Activity,
    fields: [],
  },
  {
    type: "source.telemetry",
    group: "source",
    label: "Telemetry",
    description: "Arbitrary 1 Hz metric stream (LTE, system, env).",
    icon: Radio,
    fields: [
      { key: "metric", label: "Metric", type: "text", default: "lte.rssi" },
    ],
  },
  // --- Processors ---
  {
    type: "processor.decode_sample",
    group: "processor",
    label: "Decode & Sample",
    description: "Decode the video stream and sample frames at a fixed rate.",
    icon: SlidersHorizontal,
    fields: [
      { key: "fps", label: "Sample rate", type: "number", unit: "fps", default: 2 },
    ],
  },
  {
    type: "processor.object_detection",
    group: "processor",
    label: "Object Detection",
    description: "Run a detector over sampled frames and emit bounding boxes.",
    icon: ScanEye,
    fields: [
      { key: "model", label: "Model", type: "select", options: ["yolo-n", "yolo-s", "rtdetr"], default: "yolo-s" },
      { key: "minConfidence", label: "Min confidence", type: "number", default: 0.4 },
    ],
  },
  {
    type: "processor.speed_from_gps",
    group: "processor",
    label: "Speed from GPS",
    description: "Derive ground speed and acceleration from GPS samples.",
    icon: Gauge,
    fields: [
      { key: "window", label: "Window", type: "number", unit: "s", default: 2 },
      { key: "smoothing", label: "Smoothing", type: "select", options: ["none", "ema", "kalman"], default: "ema" },
    ],
  },
  {
    type: "processor.speed_limit_check",
    group: "processor",
    label: "Speed Limit Check",
    description: "Flag GPS speed over a limit (static limit in v1; external traffic API deferred).",
    icon: Gauge,
    fields: [
      { key: "limitKph", label: "Speed limit", type: "number", unit: "km/h", default: 80 },
    ],
  },
  {
    type: "processor.imu_decel",
    group: "processor",
    label: "IMU Deceleration",
    description: "Extract longitudinal deceleration spikes from the IMU.",
    icon: Activity,
    fields: [
      { key: "axis", label: "Axis", type: "select", options: ["x", "y", "z"], default: "x" },
    ],
  },
  {
    type: "processor.sensor_fusion",
    group: "processor",
    label: "Sensor Fusion",
    description: "Align and merge multiple feature streams on a common clock.",
    icon: Cpu,
    fields: [
      { key: "syncMs", label: "Sync window", type: "number", unit: "ms", default: 200 },
    ],
  },
  // --- Logic ---
  {
    type: "logic.threshold",
    group: "logic",
    label: "Threshold",
    description: "Fire when an input crosses a configured bound.",
    icon: SlidersHorizontal,
    fields: [
      { key: "operator", label: "Operator", type: "select", options: ["<", "<=", ">", ">="], default: "<=" },
      { key: "value", label: "Value", type: "number", default: -0.4 },
      { key: "unit", label: "Unit", type: "text", default: "g" },
    ],
  },
  {
    type: "logic.composite_rule",
    group: "logic",
    label: "Composite Rule",
    description: "Combine several signals (AND / OR) into a single decision.",
    icon: GitBranch,
    fields: [
      { key: "combine", label: "Combine", type: "select", options: ["all", "any"], default: "all" },
      { key: "minSpeed", label: "Min speed", type: "number", unit: "km/h", default: 15 },
    ],
  },
  // --- Outputs ---
  {
    type: "output.event",
    group: "output",
    label: "Emit Event",
    description: "Publish a detection event with an evidence clip reference.",
    icon: Zap,
    fields: [
      { key: "kind", label: "Event kind", type: "text", default: "harsh_brake" },
      { key: "clip", label: "Attach clip", type: "select", options: ["yes", "no"], default: "yes" },
    ],
  },
  {
    type: "output.alert",
    group: "output",
    label: "Raise Alert",
    description: "Promote an event to an operator alert with a severity.",
    icon: Bell,
    fields: [
      { key: "severity", label: "Severity", type: "select", options: ["low", "medium", "high"], default: "medium" },
    ],
  },
]

export const NODE_CATALOG_BY_TYPE: Record<string, NodeCatalogEntry> =
  Object.fromEntries(NODE_CATALOG.map((entry) => [entry.type, entry]))

// Per-group presentation: a Tailwind dot colour for the node header + palette,
// a human label, and a fallback icon for nodes whose type is unknown (e.g. when
// the JSON view introduces a type that isn't in the catalog yet).
export const GROUP_META: Record<
  NodeGroup,
  { label: string; dot: string; ring: string; icon: LucideIcon }
> = {
  source: { label: "Sources", dot: "bg-sky-500", ring: "ring-sky-500/30", icon: Radio },
  processor: { label: "Processors", dot: "bg-violet-500", ring: "ring-violet-500/30", icon: Cpu },
  logic: { label: "Logic", dot: "bg-amber-500", ring: "ring-amber-500/30", icon: GitBranch },
  output: { label: "Outputs", dot: "bg-emerald-500", ring: "ring-emerald-500/30", icon: Zap },
}

export const GROUP_ORDER: NodeGroup[] = ["source", "processor", "logic", "output"]

// react-flow renders every catalog node through a single custom component; the
// catalog type lives in node.data so one component can style all groups. Keep
// this in sync with the `wfNode` key in the canvas `nodeTypes` map.
export const FLOW_NODE_TYPE = "wfNode"

export interface WfNodeData extends Record<string, unknown> {
  label: string
  catalogType: string
  config: Record<string, unknown>
}

export type WfNode = Node<WfNodeData, typeof FLOW_NODE_TYPE>

export function defaultConfig(type: string): Record<string, unknown> {
  const entry = NODE_CATALOG_BY_TYPE[type]
  const config: Record<string, unknown> = {}
  for (const field of entry?.fields ?? []) config[field.key] = field.default
  return config
}

// --- Definition <-> react-flow conversion -------------------------------------
// The stored/JSON "definition" keeps the catalog type in `node.type` (readable),
// while react-flow needs every node tagged with the single custom `wfNode` type
// and the catalog type tucked into `data`. These two helpers bridge the gap so
// the graphical canvas and the JSON view stay perfectly round-trippable.

export function definitionToFlow(def: WorkflowDefinition): {
  nodes: WfNode[]
  edges: Edge[]
} {
  const nodes: WfNode[] = def.nodes.map((node) => ({
    id: node.id,
    type: FLOW_NODE_TYPE,
    position: { ...node.position },
    data: {
      label: node.data.label,
      catalogType: node.type,
      config: { ...node.data.config },
    },
  }))
  const edges: Edge[] = def.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
  }))
  return { nodes, edges }
}

export function flowToDefinition(nodes: WfNode[], edges: Edge[]): WorkflowDefinition {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.catalogType,
      position: {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      },
      data: { label: node.data.label, config: node.data.config ?? {} },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
    })),
  }
}
