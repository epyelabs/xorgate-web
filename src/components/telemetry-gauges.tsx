import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { LatestReading } from "@/hooks/use-iot-telemetry"
import { formatMetricValue, metricLabel } from "@/lib/telemetry-meta"

export function TelemetryGauges({
  latest,
  metrics,
}: {
  latest: Record<string, LatestReading>
  metrics: string[]
}) {
  const shown = metrics.filter((m) => latest[m] !== undefined)
  if (shown.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">Waiting for telemetry…</p>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {shown.map((m) => {
        const r = latest[m]
        return (
          <Card key={m}>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                {metricLabel(m)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">
                {formatMetricValue(r.value)}
                {r.unit ? (
                  <span className="text-muted-foreground ml-1 text-sm font-normal">
                    {r.unit}
                  </span>
                ) : null}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
