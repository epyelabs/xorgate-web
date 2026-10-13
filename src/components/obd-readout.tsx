import type { IoCapabilities, LatestReading } from "@xorgate/sdk"
import { cn } from "@/lib/utils"
import { OBD_LINK_METRIC, obdMetrics } from "@/lib/capability-metrics"
import {
  formatMetricValue,
  formatUnit,
  metricLabel,
  OBD_LINK_ECU,
} from "@/lib/telemetry-meta"

// The OBD group's own grid. The Map View's METRIC_GRID draws one column per
// metric so a small group sits on one row; a model declares up to 21 OBD
// fields, so this card wraps tiles at a fixed minimum width instead and the
// row count follows the container.
const OBD_GRID =
  "grid gap-x-5 gap-y-2 [grid-template-columns:repeat(auto-fill,minmax(7rem,1fr))]"

/**
 * The OBD-II readout for a model that declares `peripherals.obd`
 * (obd2-bluetooth-integration, plan decisions 1 and 3): a titleless card of
 * label-over-value tiles, the same shape as the System and Signal cards.
 *
 * Transparency rule, owner's: every field the model declares is a tile, and
 * a tile is never hidden. The device only polls the PIDs the bus supports, so
 * a declared field with no reading while the ECU is answering means "not
 * provided", and the tile says so in words. That is not an error; a line
 * between two states of the adapter is.
 *
 * The adapter's state is `obd.link`: 2 is the ECU answering and the only
 * state in which the readings are current. Anything else (0 no adapter, 1
 * adapter only, or no reading at all) puts one plain line above the grid and
 * dashes in it, since a stale RPM presented as live is the one thing this
 * card must never do. Renders nothing for a model with no OBD fields, like
 * the other readouts.
 */
export function ObdReadout({
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
  const ecuLive = link === OBD_LINK_ECU

  return (
    <div
      className={cn(
        "@container shrink-0 rounded-lg border bg-card px-3 py-2.5 shadow-sm",
        className
      )}
      data-testid="obd-readout"
    >
      {!ecuLive ? (
        <p className="pb-2 text-xs text-muted-foreground">
          Cannot read the OBD adapter right now
        </p>
      ) : null}
      <div className={OBD_GRID}>
        {metrics.map((m) => (
          <ObdCell key={m} metric={m} reading={latest[m]} ecuLive={ecuLive} />
        ))}
      </div>
    </div>
  )
}

// One tile, the Map View's MetricCell shape (name stacked above its value).
// The link tile is the state itself, so it always shows its code; every other
// tile is only trustworthy while the ECU is answering.
function ObdCell({
  metric,
  reading,
  ecuLive,
}: {
  metric: string
  reading?: LatestReading
  ecuLive: boolean
}) {
  const isLink = metric === OBD_LINK_METRIC
  const show = isLink || ecuLive
  return (
    <div className="flex min-w-0 flex-col text-sm">
      <span className="truncate text-xs text-muted-foreground">
        {metricLabel(metric)}
      </span>
      {show && reading ? (
        <span className="font-medium tabular-nums">
          {formatMetricValue(reading.value, metric)}
          {reading.unit ? (
            <span className="ml-0.5 text-xs font-normal text-muted-foreground">
              {formatUnit(reading.unit)}
            </span>
          ) : null}
        </span>
      ) : ecuLive && !isLink ? (
        <span className="truncate text-muted-foreground">Not provided</span>
      ) : (
        <span className="font-medium tabular-nums text-muted-foreground">—</span>
      )}
    </div>
  )
}
