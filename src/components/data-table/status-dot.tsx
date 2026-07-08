import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// Status pill used across the workflow/recording/template tables: a small colored
// dot plus a label. Consolidates the duplicated `RunStatusCell`/`StatusCell`
// helpers; feature code maps its status enum to a dot color.
export function StatusDot({
  color,
  label,
  pulse,
}: {
  color: string
  label: ReactNode
  pulse?: boolean
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-1.5 rounded-full", color, pulse && "animate-pulse")} />
      <span className="text-xs">{label}</span>
    </span>
  )
}
