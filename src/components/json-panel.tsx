import { useEffect, useState, type ReactNode } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { JsonTree } from "@/components/json-tree"
import { cn } from "@/lib/utils"

/**
 * The bordered JSON pane Raw View uses on both the live and replay tabs: a thin
 * header strip, a scrolling collapsible tree, and Copy. The two tabs show
 * DIFFERENT things through it (live = the wire frame, replay = the reading set
 * resolved at the playhead), so the header is the caller's to compose; only the
 * chrome and the copy behaviour are shared.
 */
export function JsonPanelShell({
  header,
  actions,
  value,
  empty,
  openDepth = 3,
}: {
  // Left/middle of the header strip. Callers push a trailing group with
  // `ml-auto` when they want it right-aligned, as the live panel does.
  header: ReactNode
  // Extra controls seated before Copy.
  actions?: ReactNode
  // null renders `empty` instead of a tree.
  value: unknown
  empty: ReactNode
  openDepth?: number
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  // Copy yields the full document, not the tree's folded rendering — a reader
  // pasting this into an issue wants the whole thing.
  const text = value === null ? "" : JSON.stringify(value, null, 2)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // Clipboard is permission-gated; the text is selectable either way.
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-3 py-2 text-xs">
        {header}
        <span className="flex items-center gap-1">
          {actions}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={copy}
            disabled={text === ""}
          >
            {copied ? (
              <CheckIcon className="size-3.5" />
            ) : (
              <CopyIcon className="size-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {value !== null ? (
          <JsonTree value={value} openDepth={openDepth} className="p-3" />
        ) : (
          <div className="p-3 text-xs text-muted-foreground">{empty}</div>
        )}
      </div>
    </div>
  )
}

/** Shared status dot idiom (same colours as the video tiles'). */
export function StatusDot({
  className,
  pulse,
}: {
  className: string
  pulse?: boolean
}) {
  return (
    <span
      className={cn("size-2 rounded-full", className, pulse && "animate-pulse")}
      aria-hidden
    />
  )
}
