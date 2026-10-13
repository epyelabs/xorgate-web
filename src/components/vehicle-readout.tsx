import { Fragment } from "react"
import type { IoCapabilities, LatestReading } from "@xorgate/sdk"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { OBD_LINK_METRIC, obdMetrics } from "@/lib/capability-metrics"
import {
  formatMetricValue,
  formatUnit,
  metricLabel,
  OBD_LINK_VEHICLE,
} from "@/lib/telemetry-meta"

/**
 * The vehicle (OBD-II) readout for a model that declares `peripherals.obd`
 * (obd2-bluetooth-integration, plan decisions 1 and 3).
 *
 * Transparency rule, owner's: every field the model declares is a row, and a
 * row is never hidden. The device only polls the PIDs the vehicle supports,
 * so a declared field with no reading while the ECU is answering means "this
 * vehicle does not provide it", and the row says so in words. That is not an
 * error; a line between two states of the adapter is.
 *
 * The adapter's state is `obd.link`: 2 is the vehicle answering and the only
 * state in which the readings are current. Anything else (0 no adapter, 1
 * adapter only, or no reading at all) collapses the card to one plain line and
 * dashes, since a stale RPM presented as live is the one thing this card must
 * never do. Renders nothing for a model with no vehicle fields, like the other
 * readouts.
 */
export function VehicleReadout({
  caps,
  latest,
  className,
}: {
  caps: IoCapabilities | null
  latest: Record<string, LatestReading>
  className?: string
}) {
  const metrics = obdMetrics(caps)
  if (metrics.length === 0) return null
  const link = latest[OBD_LINK_METRIC]?.value ?? null
  const vehicleLive = link === OBD_LINK_VEHICLE

  return (
    <Card size="sm" className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Vehicle</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col">
        {!vehicleLive ? (
          <p className="pb-2 text-xs text-muted-foreground">
            Cannot read the OBD adapter right now
          </p>
        ) : null}
        {metrics.map((m, i) => (
          <Fragment key={m}>
            {i > 0 ? <Separator /> : null}
            <VehicleRow
              metric={m}
              reading={latest[m]}
              vehicleLive={vehicleLive}
            />
          </Fragment>
        ))}
      </CardContent>
    </Card>
  )
}

function VehicleRow({
  metric,
  reading,
  vehicleLive,
}: {
  metric: string
  reading?: LatestReading
  vehicleLive: boolean
}) {
  // The link row is the state itself, so it always shows its code; every
  // other row is only trustworthy while the vehicle is answering.
  const isLink = metric === OBD_LINK_METRIC
  const show = isLink || vehicleLive
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{metricLabel(metric)}</span>
      {show && reading ? (
        <span className="font-medium tabular-nums">
          {formatMetricValue(reading.value, metric)}
          {reading.unit ? (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {formatUnit(reading.unit)}
            </span>
          ) : null}
        </span>
      ) : vehicleLive && !isLink ? (
        <span className="text-right text-xs text-muted-foreground italic">
          not provided by this vehicle
        </span>
      ) : (
        <span className="font-medium tabular-nums text-muted-foreground">—</span>
      )}
    </div>
  )
}
