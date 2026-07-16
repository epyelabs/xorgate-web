import type { LatestReading } from "@/hooks/use-iot-telemetry"
import { formatMetricValue, metricLabel } from "@/lib/telemetry-meta"

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
  return (
    <div className="flex min-w-0 flex-col text-sm">
      <span className="truncate text-xs text-muted-foreground">
        {metricLabel(metric)}
      </span>
      <span className="font-medium tabular-nums">
        {reading ? formatMetricValue(reading.value, metric) : "—"}
        {reading?.unit ? (
          <span className="ml-0.5 text-xs font-normal text-muted-foreground">
            {reading.unit}
          </span>
        ) : null}
      </span>
    </div>
  )
}
