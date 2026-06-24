const METRIC_LABELS: Record<string, { label: string; unit?: string }> = {
  framesProcessed: { label: "Frames" },
  avgLatencyMs: { label: "Avg latency", unit: "ms" },
  eventsEmitted: { label: "Events" },
  cost: { label: "Cost" },
}

function humanize(key: string): string {
  const spaced = key.replace(/([A-Z])/g, " $1").trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// Small metric cards rendered from a run's free-form `metrics` record.
export function RunMetrics({ metrics }: { metrics: Record<string, number | string> }) {
  const entries = Object.entries(metrics)
  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No metrics recorded.</p>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {entries.map(([key, value]) => {
        const meta = METRIC_LABELS[key]
        return (
          <div
            key={key}
            className="rounded-lg border border-border bg-card px-3 py-2.5"
          >
            <p className="text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
              {meta?.label ?? humanize(key)}
            </p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">
              {value}
              {meta?.unit ? (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {meta.unit}
                </span>
              ) : null}
            </p>
          </div>
        )
      })}
    </div>
  )
}
