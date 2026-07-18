import {
  Cpu,
  Film,
  GitBranch,
  type LucideIcon,
  Puzzle,
  Radio,
  ScanEye,
  SquareFunction,
  Waves,
  Zap,
} from "lucide-react"
import type { Edge, Node } from "@xyflow/react"
import type { CatalogNodeGroup, Channel } from "./workflow-catalog-schemas"
import type { WorkflowDefinition } from "./workflow-schemas"

// Presentation constants + definition <-> react-flow conversion for the
// workflow editor. The node catalog itself is SERVED by the backend (GET
// /workflow-catalog, see store/workflow-catalog.ts); nothing here enumerates
// node types anymore.

export type NodeGroup = CatalogNodeGroup

// Per-group presentation: a Tailwind dot colour for the node header + palette,
// a human label, and a fallback icon for nodes whose type is unknown (e.g. a
// PoC-era snapshot on a run page, or a type the deployed backend no longer has).
export const GROUP_META: Record<
  NodeGroup,
  { label: string; dot: string; ring: string; icon: LucideIcon }
> = {
  source: { label: "Sources", dot: "bg-sky-500", ring: "ring-sky-500/30", icon: Radio },
  video: { label: "Video", dot: "bg-violet-500", ring: "ring-violet-500/30", icon: Film },
  telemetry: { label: "Telemetry", dot: "bg-teal-500", ring: "ring-teal-500/30", icon: Waves },
  model: { label: "Models", dot: "bg-fuchsia-500", ring: "ring-fuchsia-500/30", icon: ScanEye },
  logic: { label: "Logic", dot: "bg-amber-500", ring: "ring-amber-500/30", icon: GitBranch },
  function: {
    label: "Code Functions",
    dot: "bg-indigo-500",
    ring: "ring-indigo-500/30",
    icon: SquareFunction,
  },
  output: { label: "Outputs", dot: "bg-emerald-500", ring: "ring-emerald-500/30", icon: Zap },
  custom: { label: "Custom", dot: "bg-zinc-500", ring: "ring-zinc-500/30", icon: Puzzle },
}

export const GROUP_ORDER: NodeGroup[] = [
  "source",
  "video",
  "telemetry",
  "model",
  "logic",
  "function",
  "output",
  "custom",
]

// Fallback presentation for nodes whose type the catalog doesn't know.
export const UNKNOWN_GROUP_META = {
  label: "Unknown",
  dot: "bg-zinc-400",
  ring: "ring-zinc-400/30",
  icon: Cpu,
}

// Handle colour per channel, so edge typing is visible on the canvas. Kept
// distinct from the group palette above (a node's colour is its group; a
// port's colour is its channel).
export const CHANNEL_META: Record<Channel, { label: string; handle: string }> = {
  video: { label: "video", handle: "!bg-violet-500" },
  frames: { label: "frames", handle: "!bg-fuchsia-500" },
  telemetry: { label: "telemetry", handle: "!bg-sky-500" },
  json: { label: "json", handle: "!bg-amber-500" },
  condition: { label: "condition", handle: "!bg-emerald-500" },
  event: { label: "event", handle: "!bg-rose-500" },
}

// Definitions authored by this editor target the catalog world (backend
// upgrades v1 on read; new saves are v2).
export const DEFINITION_SCHEMA_VERSION = 2

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
    schemaVersion: DEFINITION_SCHEMA_VERSION,
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
