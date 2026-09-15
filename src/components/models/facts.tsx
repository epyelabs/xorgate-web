import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

// Key / value pairs as a definition list. `FactGrid` decides the columns,
// `Fact` renders one pair with the label in small caps above the value.
// A missing value renders as an em dash so a grid never has holes.
export function FactGrid({
  children,
  className,
  columns = "auto",
}: {
  children: ReactNode
  className?: string
  /** "auto" packs as many 9rem columns as fit; a number pins the count. */
  columns?: "auto" | 2 | 3 | 4
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-4 gap-y-3",
        columns === "auto"
          ? "[grid-template-columns:repeat(auto-fill,minmax(9rem,1fr))]"
          : columns === 2
            ? "grid-cols-2"
            : columns === 3
              ? "grid-cols-2 sm:grid-cols-3"
              : "grid-cols-2 sm:grid-cols-4",
        className,
      )}
    >
      {children}
    </dl>
  )
}

export function Fact({
  label,
  value,
  mono,
  hint,
  className,
  testId,
  span,
}: {
  label: ReactNode
  value: ReactNode
  mono?: boolean
  /** A second, quieter line under the value. */
  hint?: ReactNode
  className?: string
  testId?: string
  /** Let a long value (a prefix, a path) take the full row. */
  span?: boolean
}) {
  const empty = value === null || value === undefined || value === ""
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", span ? "col-span-full" : "", className)} data-testid={testId}>
      <dt className="text-[10px] tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className={cn("min-w-0 text-sm break-words", mono ? "font-mono text-xs" : "", empty ? "text-muted-foreground" : "")}>
        {empty ? "—" : value}
      </dd>
      {hint ? <dd className="text-[11px] text-muted-foreground">{hint}</dd> : null}
    </div>
  )
}
