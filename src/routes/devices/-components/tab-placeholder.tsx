// Placeholder shown by device detail tabs whose screens aren't built yet
// (Media, Workflows, Settings). Mirrors the dashed empty-state pattern used in
// devices-table-parts.tsx so stubbed tabs read as intentional, not broken.
export function TabPlaceholder({
  title,
  message = "Coming soon.",
}: {
  title: string
  message?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border py-16 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  )
}
