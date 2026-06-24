import { useCallback } from "react"
import {
  Background,
  Controls,
  type Edge,
  MiniMap,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { type WfNode } from "@/lib/workflow-nodes"
import { useWorkflowEditor } from "@/store/workflow-editor"
import { WorkflowNodeCard } from "./nodes/workflow-node-card"

const nodeTypes: NodeTypes = { wfNode: WorkflowNodeCard }

function CanvasInner() {
  const nodes = useWorkflowEditor((s) => s.nodes)
  const edges = useWorkflowEditor((s) => s.edges)
  const onNodesChange = useWorkflowEditor((s) => s.onNodesChange)
  const onEdgesChange = useWorkflowEditor((s) => s.onEdgesChange)
  const onConnect = useWorkflowEditor((s) => s.onConnect)
  const addNode = useWorkflowEditor((s) => s.addNode)
  const selectNode = useWorkflowEditor((s) => s.selectNode)
  const { screenToFlowPosition } = useReactFlow()

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

  return (
    <div className="h-full w-full" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow<WfNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => selectNode(node.id)}
        onPaneClick={() => selectNode(null)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        defaultEdgeOptions={{ animated: true }}
        proOptions={{ hideAttribution: true }}
        className="bg-muted/20"
      >
        <Background gap={16} className="!bg-muted/20" />
        <Controls showInteractive={false} className="!shadow-sm" />
        <MiniMap pannable zoomable className="!bg-card !ring-1 !ring-border" />
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
