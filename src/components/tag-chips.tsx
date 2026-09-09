import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// Read-only tag chips for a table row. Shows the first `max` and counts the
// rest, so a heavily tagged template cannot push the other columns off screen.
export function TagChips({
  tags,
  max = 3,
  className,
  onSelect,
}: {
  tags: string[]
  max?: number
  className?: string
  // When given, a chip is a button that filters by that tag.
  onSelect?: (tag: string) => void
}) {
  if (tags.length === 0) {
    return <span className="text-muted-foreground">—</span>
  }
  const shown = tags.slice(0, max)
  const hidden = tags.length - shown.length
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {shown.map((tag) =>
        onSelect ? (
          <button key={tag} type="button" onClick={() => onSelect(tag)}>
            <Badge variant="outline" className="hover:bg-muted">
              {tag}
            </Badge>
          </button>
        ) : (
          <Badge key={tag} variant="outline">
            {tag}
          </Badge>
        )
      )}
      {hidden > 0 ? (
        <span
          className="text-xs text-muted-foreground"
          title={tags.slice(max).join(", ")}
        >
          +{hidden}
        </span>
      ) : null}
    </span>
  )
}
