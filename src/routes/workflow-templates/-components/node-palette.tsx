import {
  GROUP_META,
  GROUP_ORDER,
  NODE_CATALOG,
  type NodeCatalogEntry,
} from "@/lib/workflow-nodes"
import { useWorkflowEditor } from "@/store/workflow-editor"
import { cn } from "@/lib/utils"

// Left rail of the editor. Each entry is draggable onto the canvas (HTML5 DnD,
// picked up by WorkflowCanvas.onDrop) and also click-to-add as a fallback for
// when dragging onto an empty canvas feels fiddly.
export function NodePalette() {
  const addNode = useWorkflowEditor((s) => s.addNode)

  const onDragStart = (event: React.DragEvent, entry: NodeCatalogEntry) => {
    event.dataTransfer.setData("application/x-wf-node", entry.type)
    event.dataTransfer.effectAllowed = "move"
  }

  return (
    <div className="flex h-full w-48 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-card/40 p-2.5">
      <p className="px-1 text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
        Nodes
      </p>
      {GROUP_ORDER.map((group) => {
        const entries = NODE_CATALOG.filter((n) => n.group === group)
        if (entries.length === 0) return null
        const meta = GROUP_META[group]
        return (
          <div key={group} className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 px-1">
              <span className={cn("size-1.5 rounded-full", meta.dot)} />
              <span className="text-[10px] font-medium text-muted-foreground">
                {meta.label}
              </span>
            </div>
            {entries.map((entry) => {
              const Icon = entry.icon
              return (
                <button
                  key={entry.type}
                  type="button"
                  draggable
                  onDragStart={(e) => onDragStart(e, entry)}
                  onClick={() => addNode(entry.type, { x: 60, y: 60 })}
                  title={entry.description}
                  className="flex cursor-grab items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-xs transition-colors hover:border-border hover:bg-accent active:cursor-grabbing"
                >
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{entry.label}</span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
