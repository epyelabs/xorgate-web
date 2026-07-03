import { useEffect, useMemo, useState } from "react"
import {
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import {
  GROUP_META,
  GROUP_ORDER,
  NODE_CATALOG,
  type NodeCatalogEntry,
} from "@/lib/workflow-nodes"
import { useWorkflowEditor } from "@/store/workflow-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const COLLAPSED_KEY = "wf-node-palette-collapsed"

// Left rail of the editor. Each entry is draggable onto the canvas (HTML5 DnD,
// picked up by WorkflowCanvas.onDrop) and also click-to-add as a fallback for
// when dragging onto an empty canvas feels fiddly. The rail collapses to a thin
// strip to reclaim canvas space, and its nodes can be searched. The catalog
// grows over time, so search is load-bearing.
export function NodePalette() {
  const addNode = useWorkflowEditor((s) => s.addNode)

  // Persist the collapsed state so the rail stays how the user left it.
  const [collapsed, setCollapsed] = useState(
    () => globalThis.localStorage?.getItem(COLLAPSED_KEY) === "1"
  )
  useEffect(() => {
    globalThis.localStorage?.setItem(COLLAPSED_KEY, collapsed ? "1" : "0")
  }, [collapsed])

  const [query, setQuery] = useState("")

  const onDragStart = (event: React.DragEvent, entry: NodeCatalogEntry) => {
    event.dataTransfer.setData("application/x-wf-node", entry.type)
    event.dataTransfer.effectAllowed = "move"
  }

  // Nodes matching the current search text, kept grouped for the section
  // headers. Groups with no surviving entries drop out entirely.
  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return GROUP_ORDER.map((group) => ({
      group,
      entries: NODE_CATALOG.filter(
        (n) =>
          n.group === group &&
          (q === "" ||
            n.label.toLowerCase().includes(q) ||
            n.description.toLowerCase().includes(q) ||
            n.type.toLowerCase().includes(q))
      ),
    })).filter((g) => g.entries.length > 0)
  }, [query])

  const resultCount = filteredGroups.reduce((sum, g) => sum + g.entries.length, 0)

  if (collapsed) {
    return (
      <div className="flex h-full w-10 shrink-0 flex-col items-center gap-2 border-r border-border bg-card/40 py-2.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(false)}
          title="Expand node palette"
          aria-label="Expand node palette"
        >
          <PanelLeftOpenIcon className="size-4" />
        </Button>
        <span className="mt-1 text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase [writing-mode:vertical-rl]">
          Nodes
        </span>
      </div>
    )
  }

  return (
    <div className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="flex shrink-0 items-center justify-between gap-1 px-2.5 pt-2.5 pb-1.5">
        <p className="px-1 text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Nodes
        </p>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setCollapsed(true)}
          title="Collapse node palette"
          aria-label="Collapse node palette"
        >
          <PanelLeftCloseIcon className="size-4" />
        </Button>
      </div>

      <div className="shrink-0 px-2.5 pb-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search nodes…"
            className="h-7 pr-7 pl-7"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2.5 pb-2.5">
        {resultCount === 0 ? (
          <p className="px-1 pt-2 text-xs text-muted-foreground">
            No nodes match your search.
          </p>
        ) : (
          filteredGroups.map(({ group, entries }) => {
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
          })
        )}
      </div>
    </div>
  )
}
