import { Handle, Position, type NodeProps } from "@xyflow/react"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover"
import {
  GROUP_META,
  NODE_CATALOG_BY_TYPE,
  type WfNode,
} from "@/lib/workflow-nodes"
import { cn } from "@/lib/utils"
import { useWorkflowEditor } from "@/store/workflow-editor"
import { NodeEditForm } from "../node-edit-form"

// The single custom node react-flow renders for every catalog node. Group (and
// thus colour + fallback icon) is resolved from the catalog type carried in
// `data.catalogType`. Sources have no input handle; outputs have no output.
//
// Clicking the node selects it and opens a Popover anchored to the card that
// holds the node editor — a lightweight, non-modal way to tweak settings and
// click away. Only the selected card renders it. Freshly dropped nodes start
// unselected, so adding one doesn't pop the editor open.
//
// Handles sit on the top (target) / bottom (source) edges: the graph flows
// vertically, top-to-bottom, so seed layouts advance along y with x as the lane.
export function WorkflowNodeCard({ id, data, selected }: NodeProps<WfNode>) {
  const selectNode = useWorkflowEditor((s) => s.selectNode)
  const entry = NODE_CATALOG_BY_TYPE[data.catalogType]
  const group = entry?.group ?? "processor"
  const meta = GROUP_META[group]
  const Icon = entry?.icon ?? meta.icon
  const isSource = group === "source"
  const isOutput = group === "output"

  return (
    <Popover
      open={selected ?? false}
      onOpenChange={(open) => {
        if (!open) selectNode(null)
      }}
    >
      <PopoverAnchor asChild>
        <div
          className={cn(
            "min-w-40 rounded-md border border-border bg-card text-card-foreground shadow-sm ring-1 ring-transparent transition-all",
            selected && cn("ring-2 ring-primary", meta.ring),
          )}
        >
          {!isSource && (
            <Handle
              type="target"
              position={Position.Top}
              className="!size-2 !border-2 !border-background !bg-muted-foreground"
            />
          )}
          <div className="flex items-center gap-2 px-2.5 py-2">
            <span className={cn("size-2 shrink-0 rounded-full", meta.dot)} />
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-xs font-medium">{data.label}</div>
              <div className="truncate text-[10px] text-muted-foreground">
                {entry?.type ?? data.catalogType}
              </div>
            </div>
          </div>
          {!isOutput && (
            <Handle
              type="source"
              position={Position.Bottom}
              className="!size-2 !border-2 !border-background !bg-muted-foreground"
            />
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        side="right"
        align="start"
        // Don't yank the caret into the first field on every node click — the
        // editor just appears; the user decides where to click. Non-modal, so
        // the canvas stays live and clicking elsewhere dismisses it.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {selected ? <NodeEditForm nodeId={id} /> : null}
      </PopoverContent>
    </Popover>
  )
}
