import { Fragment } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type { LatestReading } from "@/hooks/use-iot-telemetry"
import {
  formatMetricValue,
  formatUnit,
  metricLabel,
} from "@/lib/telemetry-meta"

// A single key/value row. Renders "—" until the first reading arrives, keeping
// the layout stable while the telemetry connection is still warming up.
function MetricRow({
  metric,
  reading,
}: {
  metric: string
  reading?: LatestReading
}) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{metricLabel(metric)}</span>
      <span className="tabular-nums font-medium">
        {reading ? formatMetricValue(reading.value, metric) : "—"}
        {reading?.unit ? (
          <span className="text-muted-foreground ml-1 text-xs font-normal">
            {formatUnit(reading.unit)}
          </span>
        ) : null}
      </span>
    </div>
  )
}

// Titled key/value card that shows a subsystem's metrics as plain text.
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
        {metrics.map((m, i) => (
          <Fragment key={m}>
            {i > 0 ? <Separator /> : null}
            <MetricRow metric={m} reading={latest[m]} />
          </Fragment>
        ))}
      </CardContent>
    </Card>
  )
}

// Like TelemetryReadout, but folds several labelled metric sets into a single
// card laid out in columns. Used to combine the IMU sub-readouts (orientation,
// euler, acceleration) into one card.
export function GroupedTelemetryReadout({
  title,
  latest,
  groups,
}: {
  title: string
  latest: Record<string, LatestReading>
  groups: { label: string; metrics: string[] }[]
}) {
  return (
    <Card size="sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-x-3">
          {groups.map((group) => (
            <div key={group.label} className="flex min-w-0 flex-col gap-1.5">
              <span className="text-muted-foreground/70 text-[0.65rem] font-medium uppercase tracking-wide">
                {group.label}
              </span>
              {group.metrics.map((m) => {
                const r = latest[m]
                return (
                  <div key={m} className="flex flex-col text-sm">
                    <span className="text-muted-foreground text-xs">
                      {metricLabel(m)}
                    </span>
                    <span className="tabular-nums font-medium">
                      {r ? formatMetricValue(r.value, m) : "—"}
                      {r?.unit ? (
                        <span className="text-muted-foreground ml-1 text-xs font-normal">
                          {formatUnit(r.unit)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
