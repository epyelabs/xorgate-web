import { create } from "zustand"
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react"
import {
  definitionToFlow,
  flowToDefinition,
  type WfNode,
} from "@/lib/workflow-nodes"
import { layoutVertical } from "@/lib/workflow-layout"
import type { PublishIssue } from "@/lib/workflow-catalog-schemas"
import { useWorkflowCatalog } from "@/store/workflow-catalog"
import {
  workflowDefinitionSchema,
  type WorkflowDefinition,
} from "@/lib/workflow-schemas"

// Single source of truth for the workflow being edited. Both the graphical
// canvas and the Monaco JSON view read and write this store, which is why
// switching tabs (each of which mounts/unmounts its editor) never loses state.
// It is a module-level singleton: only one template detail page mounts at a time
// and `loadDefinition` / `reset` rebind it on navigation.

interface WorkflowEditorState {
  nodes: WfNode[]
  edges: Edge[]
  selectedNodeId: string | null
  // True when the graph diverges from the last loaded/saved definition.
  dirty: boolean
  // Server-side publish validation issues from the last failed publish, mapped
  // onto nodes/edges by id for canvas highlighting. Cleared on load/publish.
  publishIssues: PublishIssue[]
  setPublishIssues: (issues: PublishIssue[]) => void

  loadDefinition: (definition: WorkflowDefinition) => void
  reset: () => void
  markSaved: () => void
  toDefinition: () => WorkflowDefinition

  onNodesChange: (changes: NodeChange<WfNode>[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void

  // `position` is where the node lands on the canvas (drop coordinates). Omit it
  // for click-to-add: the node is then stacked just below the bottom-most node.
  addNode: (catalogType: string, position?: { x: number; y: number }) => void
  autoLayout: () => void
  selectNode: (id: string | null) => void
  updateNodeLabel: (id: string, label: string) => void
  updateNodeConfig: (id: string, key: string, value: unknown) => void
  deleteNode: (id: string) => void

  // Parse + validate JSON, replacing the graph on success. Returns an error
  // message to show inline, or null when applied cleanly.
  setFromJson: (text: string) => string | null
}

const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

// Vertical gap left below the bottom-most node when click-adding, and the height
// assumed for a node react-flow hasn't measured yet.
const STACK_GAP = 60
const FALLBACK_NODE_HEIGHT = 64

// Placement for a click-added node: directly below whichever node currently sits
// lowest on the canvas (same column), so it reads as the next step. Falls back
// to the origin on an empty canvas.
function stackedBelow(nodes: WfNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 0, y: 0 }
  let x = nodes[0].position.x
  let maxBottom = -Infinity
  for (const n of nodes) {
    const bottom =
      n.position.y + (n.measured?.height ?? n.height ?? FALLBACK_NODE_HEIGHT)
    if (bottom > maxBottom) {
      maxBottom = bottom
      x = n.position.x
    }
  }
  return { x, y: maxBottom + STACK_GAP }
}

// Changes that represent a real edit (vs. selection / measurement noise).
function isMutating(changes: NodeChange<WfNode>[]): boolean {
  return changes.some(
    (c) =>
      c.type === "position" ||
      c.type === "add" ||
      c.type === "remove" ||
      c.type === "replace",
  )
}

export const useWorkflowEditor = create<WorkflowEditorState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  dirty: false,
  publishIssues: [],

  setPublishIssues: (issues) => set({ publishIssues: issues }),

  loadDefinition: (definition) => {
    const { nodes, edges } = definitionToFlow(definition)
    set({ nodes, edges, selectedNodeId: null, dirty: false, publishIssues: [] })
  },

  reset: () =>
    set({ nodes: [], edges: [], selectedNodeId: null, dirty: false, publishIssues: [] }),

  markSaved: () => set({ dirty: false }),

  toDefinition: () => flowToDefinition(get().nodes, get().edges),

  onNodesChange: (changes) => {
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) }))
    if (isMutating(changes)) set({ dirty: true })
  },

  onEdgesChange: (changes) => {
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges) }))
    if (changes.some((c) => c.type !== "select")) set({ dirty: true })
  },

  onConnect: (connection) =>
    set((s) => ({
      edges: addEdge({ ...connection, id: uid("e"), animated: true }, s.edges),
      dirty: true,
    })),

  addNode: (catalogType, position) => {
    // Label + config defaults come from the served catalog (see the
    // workflow-catalog store, loaded by the editor page before the palette
    // can produce a type to add).
    const entry = useWorkflowCatalog.getState().byType[catalogType]
    if (!entry) return
    const id = uid("n")
    const node: WfNode = {
      id,
      type: "wfNode",
      position: position ?? stackedBelow(get().nodes),
      data: {
        label: entry.label,
        catalogType,
        config: { ...entry.configDefaults },
      },
    }
    // Drop the node in unselected so it doesn't auto-open the settings popover;
    // the user clicks it when they actually want to edit. Any prior selection is
    // cleared so a stray popover doesn't linger over the new node.
    set((s) => ({
      nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: false }],
      selectedNodeId: null,
      dirty: true,
    }))
  },

  autoLayout: () =>
    set((s) => ({ nodes: layoutVertical(s.nodes, s.edges), dirty: true })),

  selectNode: (id) =>
    set((s) => ({
      selectedNodeId: id,
      nodes: s.nodes.map((n) => ({ ...n, selected: n.id === id })),
    })),

  updateNodeLabel: (id, label) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, label } } : n,
      ),
      dirty: true,
    })),

  updateNodeConfig: (id, key, value) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } }
          : n,
      ),
      dirty: true,
    })),

  deleteNode: (id) =>
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
      dirty: true,
    })),

  setFromJson: (text) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      return (err as Error).message
    }
    const result = workflowDefinitionSchema.safeParse(parsed)
    if (!result.success) {
      const issue = result.error.issues[0]
      return issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid workflow definition"
    }
    // Hand-pasted v1 JSON: map PoC node types onto their catalog equivalents
    // via the served alias table (types only; configs are left as-is and any
    // mismatch surfaces as a publish validation issue).
    let definition = result.data
    if ((definition.schemaVersion ?? 1) < 2) {
      const aliases = useWorkflowCatalog.getState().catalog?.aliases ?? {}
      definition = {
        ...definition,
        nodes: definition.nodes.map((n) =>
          aliases[n.type] ? { ...n, type: aliases[n.type] } : n,
        ),
      }
    }
    const { nodes, edges } = definitionToFlow(definition)
    set({ nodes, edges, selectedNodeId: null, dirty: true })
    return null
  },
}))
