import type { ReactNode } from "react"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { formatMetric, formatPercent } from "@/lib/models-format"

// One evaluation number. A ratio metric (mAP, precision, recall) reads as a
// percentage with a bar under it so a row of tiles compares at a glance; the
// exact four-decimal value stays underneath for anyone matching a report. A
// "raw" tile (a threshold, an epoch count) shows the number as given.
export function MetricTile({
  label,
  value,
  format = "ratio",
  digits,
  hint,
  className,
  testId,
  valueTestId,
}: {
  label: ReactNode
  value: number | null | undefined
  format?: "ratio" | "raw"
  /** Decimals for the raw line (default 4 for a ratio, 2 for raw). */
  digits?: number
  hint?: ReactNode
  className?: string
  testId?: string
  valueTestId?: string
}) {
  const has = typeof value === "number" && Number.isFinite(value)
  const d = digits ?? (format === "ratio" ? 4 : 2)
  const pct = has ? Math.max(0, Math.min(100, (value as number) * 100)) : 0
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-muted/20 p-3", className)}
      data-testid={testId}
    >
      <span className="text-[10px] leading-tight tracking-wider text-muted-foreground uppercase">{label}</span>
      {format === "ratio" ? (
        <>
          <span className={cn("text-lg leading-none font-semibold tabular-nums", has ? "" : "text-muted-foreground")}>
            {has ? formatPercent(value, 1) : "—"}
          </span>
          <Progress value={pct} aria-label={typeof label === "string" ? label : undefined} />
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums" data-testid={valueTestId}>
            {formatMetric(value, d)}
          </span>
        </>
      ) : (
        <span
          className={cn("font-mono text-lg leading-none font-semibold tabular-nums", has ? "" : "text-muted-foreground")}
          data-testid={valueTestId}
        >
          {has ? (Number.isInteger(value) ? String(value) : formatMetric(value, d)) : "—"}
        </span>
      )}
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </div>
  )
}
