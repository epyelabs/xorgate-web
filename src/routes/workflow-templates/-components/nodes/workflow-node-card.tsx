import { Handle, Position, type NodeProps } from "@xyflow/react"
import {
  GROUP_META,
  NODE_CATALOG_BY_TYPE,
  type WfNode,
} from "@/lib/workflow-nodes"
import { cn } from "@/lib/utils"

// The single custom node react-flow renders for every catalog node. Group (and
// thus colour + fallback icon) is resolved from the catalog type carried in
// `data.catalogType`. Sources have no input handle; outputs have no output.
export function WorkflowNodeCard({ data, selected }: NodeProps<WfNode>) {
  const entry = NODE_CATALOG_BY_TYPE[data.catalogType]
  const group = entry?.group ?? "processor"
  const meta = GROUP_META[group]
  const Icon = entry?.icon ?? meta.icon
  const isSource = group === "source"
  const isOutput = group === "output"

  return (
    <div
      className={cn(
        "min-w-40 rounded-md border border-border bg-card text-card-foreground shadow-sm ring-1 ring-transparent transition-all",
        selected && cn("ring-2 ring-primary", meta.ring),
      )}
    >
      {!isSource && (
        <Handle
          type="target"
          position={Position.Left}
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
          position={Position.Right}
          className="!size-2 !border-2 !border-background !bg-muted-foreground"
        />
      )}
    </div>
  )
}
