import type { ReactNode } from "react"
import type { IoCapabilities } from "@xorgate/sdk"
import type { LatestReading } from "@xorgate/sdk"
import {
  signalMetrics,
  systemReadoutMetrics,
} from "@/lib/capability-metrics"
import { DeviceStatusDot } from "@/components/device-status-dot"
import { MetricCell } from "@/components/telemetry-metric-cell"
import { METRIC_GRID, metricGridStyle } from "@/lib/telemetry-grid"

// One card of labelled name/value pairs in the auto-fit metric grid. The metric
// names carry the subsystem ("CPU Usage", "LTE RSSI"), so no heading is needed.
// Renders nothing when the device produces none of these metrics. A
// `cornerSlot` (the System card's status dot) sits in the top-right corner,
// with room reserved so the grid never runs under it.
function MetricCard({
  metrics,
  latest,
  cornerSlot,
}: {
  metrics: string[]
  latest: Record<string, LatestReading>
  cornerSlot?: ReactNode
}) {
  if (metrics.length === 0) return null
  return (
    <div
      className={
        cornerSlot
          ? "@container relative shrink-0 rounded-lg border bg-card py-2.5 pr-7 pl-3 shadow-sm"
          : "@container shrink-0 rounded-lg border bg-card px-3 py-2.5 shadow-sm"
      }
    >
      {cornerSlot ? (
        <div className="absolute top-1.5 right-1.5">{cornerSlot}</div>
      ) : null}
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
 * indicator beside the online/offline status in the device header. The status
 * LED is the coloured dot in the System card's corner (no tiles of its own).
 */
export function TelemetryPanel({
  caps,
  latest,
  online = true,
}: {
  caps: IoCapabilities | null
  latest: Record<string, LatestReading>
  /** Live: the device's presence. Replay: always true (follows the playhead). */
  online?: boolean
}) {
  const hasStatus = (caps?.system?.fields ?? []).includes("led_state")
  return (
    <>
      <MetricCard
        metrics={systemReadoutMetrics(caps)}
        latest={latest}
        cornerSlot={
          hasStatus ? (
            <DeviceStatusDot
              ledState={latest["system.led_state"]?.value}
              healthFlags={latest["system.health_flags"]?.value}
              online={online}
            />
          ) : undefined
        }
      />
      <MetricCard metrics={signalMetrics(caps)} latest={latest} />
    </>
  )
}
