import type { IoCapabilities } from "@/lib/api"
import type { LatestReading } from "@/hooks/use-iot-telemetry"
import { signalMetrics, systemMetrics } from "@/lib/capability-metrics"
import { MetricCell } from "@/components/telemetry-metric-cell"
import { METRIC_GRID, metricGridStyle } from "@/lib/telemetry-grid"

/**
 * System + signal readout for the Map View's side column: one card, one row of
 * labelled name/value pairs. The metric names carry the subsystem ("CPU Usage",
 * "LTE RSSI"), so no group headings are needed.
 *
 * Signal comes last, which puts it flush right in the auto-fit grid — the two
 * subsystems read as separate clusters purely from position.
 *
 * The other metric groups live elsewhere: GPS rides as a strip over the map
 * (position is the map's subject), and the IMU is in ImuPanel with the 3D box
 * its numbers drive.
 */
export function TelemetryPanel({
  caps,
  latest,
}: {
  caps: IoCapabilities | null
  latest: Record<string, LatestReading>
}) {
  const metrics = [...systemMetrics(caps), ...signalMetrics(caps)]
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
