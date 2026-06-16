import { Fragment } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type { LatestReading } from "@/hooks/use-iot-telemetry"
import { formatMetricValue, metricLabel } from "@/lib/telemetry-meta"

// Titled key/value card that shows a subsystem's metrics as plain text.
// Missing metrics render "—" until the first reading arrives, keeping the
// layout stable while the telemetry connection is still warming up.
export function TelemetryReadout({
  title,
  latest,
  metrics,
}: {
  title: string
  latest: Record<string, LatestReading>
  metrics: string[]
}) {
  return (
    <Card size="sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col">
        {metrics.map((m, i) => {
          const r = latest[m]
          return (
            <Fragment key={m}>
              {i > 0 ? <Separator /> : null}
              <div className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-muted-foreground">{metricLabel(m)}</span>
                <span className="tabular-nums font-medium">
                  {r ? formatMetricValue(r.value, m) : "—"}
                  {r?.unit ? (
                    <span className="text-muted-foreground ml-1 text-xs font-normal">
                      {r.unit}
                    </span>
                  ) : null}
                </span>
              </div>
            </Fragment>
          )
        })}
      </CardContent>
    </Card>
  )
}
