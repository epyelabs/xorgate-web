import type { LatestReading } from "@xorgate/sdk"
import {
  formatMetricValue,
  formatUnit,
  metricLabel,
} from "@/lib/telemetry-meta"
import { cn } from "@/lib/utils"

// One metric: name stacked directly above its value, matching the card view's
// GroupedTelemetryReadout. Stacking (rather than a name/value row) keeps the two
// tied together in wide grid cells, where justified pairs leave a river of
// whitespace between the label and the number it belongs to.
//
// Callers lay these out with METRIC_GRID (lib/telemetry-grid), whose columns are
// equal width, so the cell never resizes with its value: a number growing a digit
// shifts nothing else on the row, and tabular-nums keeps the digits themselves
// from dancing as they stream in. Renders "—" until the first reading arrives.
export function MetricCell({
  metric,
  reading,
}: {
  metric: string
  reading?: LatestReading
}) {
  const text = reading ? formatMetricValue(reading.value, metric) : "—"
  return (
    <div className="flex min-w-0 flex-col text-sm">
      <span className="truncate text-xs text-muted-foreground">
        {metricLabel(metric)}
      </span>
      {/* A unit-less value may be a decoded state ("Network recovering",
          "LTE down, Cloud link down"): truncated like the label so it cannot
          wrap the equal-width grid, full text in the title. A value with a
          unit keeps wrapping, so the number itself is never cut. */}
      <span
        className={cn("font-medium tabular-nums", !reading?.unit && "truncate")}
        title={reading?.unit ? undefined : text}
      >
        {text}
        {reading?.unit ? (
          <span className="ml-0.5 text-xs font-normal text-muted-foreground">
            {formatUnit(reading.unit)}
          </span>
        ) : null}
      </span>
    </div>
  )
}
