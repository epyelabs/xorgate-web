import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// A status as an outline pill with the colour dot the tables use, for page
// headers where a bare StatusDot is too quiet next to a title.
export function StatusBadge({
  color,
  label,
  pulse,
  className,
  testId,
}: {
  color: string
  label: ReactNode
  pulse?: boolean
  className?: string
  testId?: string
}) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-normal", className)} data-testid={testId}>
      <span className={cn("size-1.5 shrink-0 rounded-full", color, pulse ? "animate-pulse" : "")} />
      {label}
    </Badge>
  )
}
