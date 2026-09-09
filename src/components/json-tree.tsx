import { useState } from "react"
import { ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// A hand-rolled collapsible JSON tree for run artifacts: no editor
// dependency, renders any parsed value. Objects and arrays fold; the root and
// its first level start open. Containers render at most PAGE children at a
// time with a "show more" affordance, so a 50k-line records file never mounts
// 50k rows at once.

const PAGE = 200
const PREVIEW_CHARS = 72

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function preview(value: unknown): string {
  let text: string
  try {
    text = JSON.stringify(value) ?? ""
  } catch {
    return ""
  }
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text
}

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span className="text-muted-foreground">null</span>
  if (value === undefined)
    return <span className="text-muted-foreground">undefined</span>
  switch (typeof value) {
    case "string":
      return (
        <span className="break-all whitespace-pre-wrap text-emerald-700 dark:text-emerald-400">
          {JSON.stringify(value)}
        </span>
      )
    case "number":
      return <span className="text-sky-700 dark:text-sky-400">{String(value)}</span>
    case "boolean":
      return (
        <span className="text-amber-700 dark:text-amber-400">{String(value)}</span>
      )
    default:
      return <span>{String(value)}</span>
  }
}

function JsonNode({
  name,
  value,
  depth,
}: {
  name: string | null
  value: unknown
  depth: number
}) {
  const [open, setOpen] = useState(depth < 2)
  const [limit, setLimit] = useState(PAGE)
  const container = Array.isArray(value) || isObject(value)
  const label =
    name !== null ? (
      <span className="shrink-0 text-foreground/80">{name}:</span>
    ) : null

  if (!container) {
    return (
      <div className="flex gap-1 py-px pl-4">
        {label}
        <Primitive value={value} />
      </div>
    )
  }

  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value)
  const count = entries.length
  const kind = Array.isArray(value) ? `Array(${count})` : `Object(${count})`

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 rounded py-px text-left hover:bg-accent/50"
        aria-expanded={open}
      >
        <ChevronRightIcon
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        {label}
        <span className="shrink-0 text-muted-foreground">{kind}</span>
        {!open && count > 0 ? (
          <span className="truncate text-muted-foreground/60">{preview(value)}</span>
        ) : null}
      </button>
      {open ? (
        <div className="ml-1.5 border-l border-border/60 pl-2">
          {entries.slice(0, limit).map(([k, v]) => (
            <JsonNode key={k} name={k} value={v} depth={depth + 1} />
          ))}
          {count > limit ? (
            <button
              type="button"
              onClick={() => setLimit((l) => l + PAGE)}
              className="py-0.5 pl-4 text-[11px] text-primary hover:underline"
            >
              Show {Math.min(PAGE, count - limit)} more ({count - limit} remaining)
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function JsonTree({
  value,
  className,
}: {
  value: unknown
  className?: string
}) {
  return (
    <div className={cn("font-mono text-[11px] leading-relaxed", className)}>
      <JsonNode name={null} value={value} depth={0} />
    </div>
  )
}
