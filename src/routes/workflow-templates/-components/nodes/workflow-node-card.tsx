import { useMemo } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover"
import {
  channelLabel,
  type CatalogPort,
} from "@/lib/workflow-catalog-schemas"
import { catalogIcon } from "@/lib/workflow-node-icons"
import {
  CHANNEL_META,
  GROUP_META,
  UNKNOWN_GROUP_META,
  type WfNode,
} from "@/lib/workflow-nodes"
import { cn } from "@/lib/utils"
import { useWorkflowCatalog } from "@/store/workflow-catalog"
import { useWorkflowEditor } from "@/store/workflow-editor"
import { NodeEditForm } from "../node-edit-form"

// The single custom node react-flow renders for every catalog node. The type
// def (group, icon, ports) is resolved from the SERVED catalog via the type
// carried in `data.catalogType`; unknown types (old snapshots, catalog not
// loaded on read-only pages) fall back to generic handles + neutral styling.
//
// Handles are TYPED: one per port, id = the port id (so new edges carry
// sourceHandle/targetHandle = port ids on the wire), coloured by channel.
// Inputs sit on the top edge, outputs on the bottom, spread evenly.
//
// Clicking the node selects it and opens a Popover anchored to the card that
// holds the node editor. Freshly dropped nodes start unselected.

function portHandles(ports: CatalogPort[], type: "target" | "source") {
  const position = type === "target" ? Position.Top : Position.Bottom
  return ports.map((port, i) => (
    <Handle
      key={port.id}
      id={port.id}
      type={type}
      position={position}
      title={`${port.label} (${channelLabel(port)}${port.required ? ", required" : ""})`}
      style={{ left: `${((i + 1) * 100) / (ports.length + 1)}%` }}
      className={cn(
        "!size-2 !border-2 !border-background",
        CHANNEL_META[port.channel]?.handle ?? "!bg-muted-foreground",
      )}
    />
  ))
}

export function WorkflowNodeCard({ id, data, selected }: NodeProps<WfNode>) {
  const selectNode = useWorkflowEditor((s) => s.selectNode)
  const publishIssues = useWorkflowEditor((s) => s.publishIssues)
  const entry = useWorkflowCatalog((s) => s.byType[data.catalogType])

  const meta = entry ? GROUP_META[entry.group] : UNKNOWN_GROUP_META
  const Icon = (entry && catalogIcon(entry.ui.icon)) ?? meta.icon

  const nodeIssues = useMemo(
    () => publishIssues.filter((iss) => iss.nodeId === id),
    [publishIssues, id],
  )

  return (
    <Popover
      open={selected ?? false}
      onOpenChange={(open) => {
        if (!open) selectNode(null)
      }}
    >
      <PopoverAnchor asChild>
        <div
          title={nodeIssues[0]?.message}
          className={cn(
            "min-w-40 rounded-md border border-border bg-card text-card-foreground shadow-sm ring-1 ring-transparent transition-all",
            selected && cn("ring-2 ring-primary", meta.ring),
            nodeIssues.length > 0 && "border-destructive ring-1 ring-destructive/50",
          )}
        >
          {entry ? (
            portHandles(entry.inputs, "target")
          ) : (
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
              <div
                className={cn(
                  "truncate text-[10px] text-muted-foreground",
                  nodeIssues.length > 0 && "text-destructive",
                )}
              >
                {nodeIssues.length > 0
                  ? nodeIssues[0].message
                  : data.catalogType}
              </div>
            </div>
          </div>
          {entry ? (
            portHandles(entry.outputs, "source")
          ) : (
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
