import { useMemo, useState } from "react"
import { SearchIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { IoCapabilities } from "@xorgate/sdk"
import { missingCapabilities } from "@/lib/capability-metrics"
import type { WorkflowTemplateSummary } from "@/lib/workflow-schemas"

// Searchable, scrollable template list. Scales to 100s of templates via a plain
// client-side filter; templates already attached to this device are shown but
// disabled so the same template can't be attached twice. Templates whose graph
// needs capabilities this device model lacks are flagged incompatible and
// disabled (the server enforces this on attach too).
export function TemplatePicker({
  templates,
  value,
  onSelect,
  attachedTemplateIds,
  deviceCapabilities,
}: {
  templates: WorkflowTemplateSummary[] | null
  value: string
  onSelect: (templateId: string) => void
  attachedTemplateIds: string[]
  deviceCapabilities: IoCapabilities | null
}) {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    if (!templates) return []
    const q = query.trim().toLowerCase()
    if (!q) return templates
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q),
    )
  }, [templates, query])

  if (templates === null) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (templates.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
        No published templates yet. Publish a template first.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates…"
          className="pl-8"
        />
      </div>
      <div
        role="radiogroup"
        className="max-h-64 overflow-y-auto rounded-md border border-border"
      >
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            No templates match “{query}”.
          </p>
        ) : (
          filtered.map((t) => {
            const attached = attachedTemplateIds.includes(t.id)
            const missing = missingCapabilities(
              t.requiredCapabilities,
              deviceCapabilities,
            )
            const incompatible = missing.length > 0
            const disabled = attached || incompatible
            const selected = t.id === value
            const version = t.publishedVersion ?? t.currentVersion
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                title={
                  incompatible ? `Missing capabilities: ${missing.join(", ")}` : undefined
                }
                onClick={() => onSelect(t.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 border-b border-border px-3 py-2 text-left last:border-b-0 transition-colors",
                  disabled
                    ? "cursor-not-allowed opacity-60"
                    : "hover:bg-muted/50",
                  selected && "bg-primary/5",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                    selected
                      ? "border-primary"
                      : "border-muted-foreground/40",
                  )}
                >
                  {selected ? (
                    <span className="size-2 rounded-full bg-primary" />
                  ) : null}
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {t.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t.slug} · v{version}
                  </span>
                </div>
                {attached ? (
                  <Badge variant="outline">Attached</Badge>
                ) : incompatible ? (
                  <Badge
                    variant="outline"
                    className="border-amber-500/40 text-amber-600 dark:text-amber-500"
                  >
                    Incompatible
                  </Badge>
                ) : null}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
