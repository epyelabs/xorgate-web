import type { IoCapabilities } from "@xorgate/sdk"
import type { LatestReading } from "@xorgate/sdk"
import { signalMetrics, systemMetrics } from "@/lib/capability-metrics"
import { MetricCell } from "@/components/telemetry-metric-cell"
import { METRIC_GRID, metricGridStyle } from "@/lib/telemetry-grid"

// One card of labelled name/value pairs in the auto-fit metric grid. The metric
// names carry the subsystem ("CPU Usage", "LTE RSSI"), so no heading is needed.
// Renders nothing when the device produces none of these metrics.
function MetricCard({
  metrics,
  latest,
}: {
  metrics: string[]
  latest: Record<string, LatestReading>
}) {
  if (metrics.length === 0) return null
  return (
    <div className="@container shrink-0 rounded-lg border bg-card px-3 py-2.5 shadow-sm">
      <div className={METRIC_GRID} style={metricGridStyle(metrics.length)}>
        {metrics.map((m) => (
          <MetricCell key={m} metric={m} reading={latest[m]} />
        ))}
      </div>
    </div>
  )
}

/**
 * System + signal readout for the Map View's side column. System and signal
 * each get their OWN card so the two subsystems stay legible as either grows
 * (they scale independently — a combined grid mixed unrelated metrics into one
 * ambiguous row). Both stack in the column's gap; each self-hides when the
 * device produces none of its metrics.
 *
 * The other metric groups live elsewhere: GPS rides as a strip over the map
 * (position is the map's subject), and the IMU is in ImuPanel with the 3D box
 * its numbers drive. Power-throttle state also surfaces as the lightning
 * indicator beside the online/offline status in the device header.
 */
export function TelemetryPanel({
  caps,
  latest,
}: {
  caps: IoCapabilities | null
  latest: Record<string, LatestReading>
}) {
  return (
    <>
      <MetricCard metrics={systemMetrics(caps)} latest={latest} />
      <MetricCard metrics={signalMetrics(caps)} latest={latest} />
    </>
  )
}
