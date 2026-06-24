import {
  Background,
  Controls,
  type Edge,
  type NodeTypes,
  ReactFlow,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { definitionToFlow, type WfNode } from "@/lib/workflow-nodes"
import type { WorkflowDefinition } from "@/lib/workflow-schemas"
import { WorkflowNodeCard } from "@/routes/workflow-templates/-components/nodes/workflow-node-card"

const nodeTypes: NodeTypes = { wfNode: WorkflowNodeCard }

// Read-only snapshot of the graph that ran. Reuses the editor's node card +
// definition converter; all interaction is disabled and the failed node (if
// any) is ringed. Parent should pass a stable `key` (the run id) so the
// uncontrolled defaultNodes re-seed when navigating between runs.
export function RunGraph({
  definition,
  failedNodeId,
}: {
  definition: WorkflowDefinition
  failedNodeId?: string | null
}) {
  const { nodes, edges } = definitionToFlow(definition)
  const decorated: WfNode[] = nodes.map((n) =>
    failedNodeId && n.id === failedNodeId
      ? { ...n, className: "rounded-md ring-2 ring-destructive" }
      : n,
  )

  return (
    <ReactFlow<WfNode, Edge>
      defaultNodes={decorated}
      defaultEdges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      zoomOnScroll={false}
      panOnScroll
      fitView
      fitViewOptions={{ padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
      className="bg-muted/20"
    >
      <Background gap={16} className="!bg-muted/20" />
      <Controls showInteractive={false} className="!shadow-sm" />
    </ReactFlow>
  )
}
