import { useCallback, useMemo, useRef, useState } from "react"
import {
  Background,
  ControlButton,
  Controls,
  type Connection,
  type Edge,
  MiniMap,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { Map as MapIcon, Maximize, Minus, Network, Plus } from "lucide-react"
import { channelsCompatible } from "@/lib/workflow-catalog-schemas"
import { type WfNode } from "@/lib/workflow-nodes"
import { useWorkflowCatalog } from "@/store/workflow-catalog"
import { useWorkflowEditor } from "@/store/workflow-editor"
import { WorkflowNodeCard } from "./nodes/workflow-node-card"

const nodeTypes: NodeTypes = { wfNode: WorkflowNodeCard }

// Shared style for every control-bar icon. `fill: none` beats react-flow's
// controls CSS (which forces `fill: currentColor` and would fill lucide's
// outline icons solid); the heavier `strokeWidth` (lucide defaults to 2) gives
// them more presence at the small size the controls render them. We also
// replace the built-in zoom/fit buttons with lucide icons so the whole bar
// shares one icon family, weight, and size.
const CONTROL_ICON = { fill: "none", strokeWidth: 2.5 } as const

function CanvasInner() {
  const nodes = useWorkflowEditor((s) => s.nodes)
  const edges = useWorkflowEditor((s) => s.edges)
  const onNodesChange = useWorkflowEditor((s) => s.onNodesChange)
  const onEdgesChange = useWorkflowEditor((s) => s.onEdgesChange)
  const onConnect = useWorkflowEditor((s) => s.onConnect)
  const addNode = useWorkflowEditor((s) => s.addNode)
  const autoLayout = useWorkflowEditor((s) => s.autoLayout)
  const selectNode = useWorkflowEditor((s) => s.selectNode)
  const { screenToFlowPosition, fitView, zoomIn, zoomOut } = useReactFlow()
  // Minimap is opt-in — hidden by default to keep the canvas clean; toggled from
  // the controls bar.
  const [showMinimap, setShowMinimap] = useState(false)
  // Set while a node drag is in flight so the click react-flow synthesizes at
  // drag-end doesn't re-open the settings popover. Cleared a tick after the
  // drag stops, once that trailing click has already fired.
  const draggingRef = useRef(false)

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const type = event.dataTransfer.getData("application/x-wf-node")
      if (!type) return
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      addNode(type, position)
    },
    [screenToFlowPosition, addNode],
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }, [])

  // Re-flow the graph top-to-bottom, then re-frame it once react-flow has
  // painted the new positions.
  const onAutoLayout = useCallback(() => {
    autoLayout()
    requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }))
  }, [autoLayout, fitView])

  // Typed-edge validation while dragging a connection: channels (+ json tags)
  // must match and single-connection inputs must be free. Permissive whenever
  // the catalog can't resolve a node or port — publish validation on the
  // backend is authoritative and reports precisely.
  const isValidConnection = useCallback((conn: Connection | Edge): boolean => {
    if (!conn.source || !conn.target || conn.source === conn.target) return false
    const { byType } = useWorkflowCatalog.getState()
    const { nodes: allNodes, edges: allEdges } = useWorkflowEditor.getState()
    const sourceNode = allNodes.find((n) => n.id === conn.source)
    const targetNode = allNodes.find((n) => n.id === conn.target)
    const sourceDef = sourceNode && byType[sourceNode.data.catalogType]
    const targetDef = targetNode && byType[targetNode.data.catalogType]
    if (!sourceDef || !targetDef) return true
    const out =
      sourceDef.outputs.find((p) => p.id === conn.sourceHandle) ??
      (sourceDef.outputs.length === 1 ? sourceDef.outputs[0] : undefined)
    const inp =
      targetDef.inputs.find((p) => p.id === conn.targetHandle) ??
      (targetDef.inputs.length === 1 ? targetDef.inputs[0] : undefined)
    if (!out || !inp) return true
    if (!channelsCompatible(out, inp)) return false
    if (inp.cardinality === "one") {
      const taken = allEdges.some(
        (e) =>
          e.target === conn.target &&
          (e.targetHandle ?? (targetDef.inputs.length === 1 ? inp.id : undefined)) ===
            inp.id,
      )
      if (taken) return false
    }
    return true
  }, [])

  // Publish-validation issues anchored to edges tint those edges destructive.
  const publishIssues = useWorkflowEditor((s) => s.publishIssues)
  const decoratedEdges = useMemo(() => {
    const badEdges = new Set(
      publishIssues.map((iss) => iss.edgeId).filter(Boolean) as string[],
    )
    if (badEdges.size === 0) return edges
    return edges.map((e) =>
      badEdges.has(e.id)
        ? { ...e, style: { ...e.style, stroke: "var(--destructive)" } }
        : e,
    )
  }, [edges, publishIssues])

  return (
    <div className="h-full w-full" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow<WfNode, Edge>
        nodes={nodes}
        edges={decoratedEdges}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        // Select (and open the settings popover) on a genuine click only.
        // Dragging must not select: selectNodesOnDrag stops react-flow selecting
        // the node when a drag begins, and the draggingRef guard drops the click
        // react-flow synthesizes when the drag ends.
        selectNodesOnDrag={false}
        onNodeDragStart={() => {
          draggingRef.current = true
        }}
        onNodeDragStop={() => {
          // Clear on the next frame so the trailing drag-end click still sees it.
          requestAnimationFrame(() => {
            draggingRef.current = false
          })
        }}
        onNodeClick={(_, node) => {
          if (draggingRef.current) return
          selectNode(node.id)
        }}
        onPaneClick={() => selectNode(null)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        // smoothstep gives clean orthogonal elbows for the top-to-bottom flow.
        // Merged into every edge at render, so loaded + freshly drawn edges match.
        defaultEdgeOptions={{ animated: true, type: "smoothstep" }}
        proOptions={{ hideAttribution: true }}
        className="bg-muted/20"
      >
        <Background gap={16} className="!bg-muted/20" />
        <Controls
          showZoom={false}
          showFitView={false}
          showInteractive={false}
          className="!shadow-sm"
        >
          <ControlButton onClick={() => zoomIn()} title="Zoom in" aria-label="Zoom in">
            <Plus style={CONTROL_ICON} />
          </ControlButton>
          <ControlButton onClick={() => zoomOut()} title="Zoom out" aria-label="Zoom out">
            <Minus style={CONTROL_ICON} />
          </ControlButton>
          <ControlButton
            onClick={() => fitView({ padding: 0.2, duration: 300 })}
            title="Fit view"
            aria-label="Fit view"
          >
            <Maximize style={CONTROL_ICON} />
          </ControlButton>
          <ControlButton onClick={onAutoLayout} title="Auto layout" aria-label="Auto layout">
            <Network style={CONTROL_ICON} />
          </ControlButton>
          <ControlButton
            onClick={() => setShowMinimap((v) => !v)}
            title={showMinimap ? "Hide minimap" : "Show minimap"}
            aria-label={showMinimap ? "Hide minimap" : "Show minimap"}
          >
            <MapIcon style={CONTROL_ICON} />
          </ControlButton>
        </Controls>
        {showMinimap && (
          <MiniMap pannable zoomable className="!bg-card !ring-1 !ring-border" />
        )}
      </ReactFlow>
    </div>
  )
}

// react-flow needs a provider above any component that calls its hooks; we keep
// it local to the canvas so the rest of the page is unaffected.
export function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
