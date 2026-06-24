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
  defaultConfig,
  definitionToFlow,
  flowToDefinition,
  NODE_CATALOG_BY_TYPE,
  type WfNode,
} from "@/lib/workflow-nodes"
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

  loadDefinition: (definition: WorkflowDefinition) => void
  reset: () => void
  markSaved: () => void
  toDefinition: () => WorkflowDefinition

  onNodesChange: (changes: NodeChange<WfNode>[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void

  addNode: (catalogType: string, position: { x: number; y: number }) => void
  selectNode: (id: string | null) => void
  updateNodeLabel: (id: string, label: string) => void
  updateNodeConfig: (id: string, key: string, value: unknown) => void
  deleteNode: (id: string) => void

  // Parse + validate JSON, replacing the graph on success. Returns an error
  // message to show inline, or null when applied cleanly.
  setFromJson: (text: string) => string | null
}

const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

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

  loadDefinition: (definition) => {
    const { nodes, edges } = definitionToFlow(definition)
    set({ nodes, edges, selectedNodeId: null, dirty: false })
  },

  reset: () => set({ nodes: [], edges: [], selectedNodeId: null, dirty: false }),

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
    const entry = NODE_CATALOG_BY_TYPE[catalogType]
    if (!entry) return
    const id = uid("n")
    const node: WfNode = {
      id,
      type: "wfNode",
      position,
      data: { label: entry.label, catalogType, config: defaultConfig(catalogType) },
    }
    set((s) => ({
      nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }],
      selectedNodeId: id,
      dirty: true,
    }))
  },

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
    const { nodes, edges } = definitionToFlow(result.data)
    set({ nodes, edges, selectedNodeId: null, dirty: true })
    return null
  },
}))
