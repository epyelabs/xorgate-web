import type { ImuView, IoCapabilities } from "@/lib/api"
import type { LatestReading } from "@/hooks/use-iot-telemetry"
import {
  imuAccelMetrics,
  imuEulerMetrics,
  imuQuaternionMetrics,
} from "@/lib/capability-metrics"
import { MetricCell } from "@/components/telemetry-metric-cell"
import { METRIC_GRID, metricGridStyle } from "@/lib/telemetry-grid"
import { ImuOrientationView } from "@/components/imu-orientation-view"

/**
 * Everything the IMU produces, in one card: the orientation quaternion and the
 * linear acceleration as numbers, above the 3D car that the euler angles drive.
 * They share a sensor, so they share a card.
 *
 * The euler angles themselves are not in the grid — the car *is* their readout,
 * and it carries them as numbers in its own corner overlay.
 *
 * Grows to fill the column: the car takes whatever height the numbers and the
 * card's siblings leave over.
 */
export function ImuPanel({
  caps,
  latest,
  view,
}: {
  caps: IoCapabilities | null
  latest: Record<string, LatestReading>
  // Per-device camera angle for the 3D view (device settings).
  view?: ImuView | null
}) {
  const metrics = [...imuQuaternionMetrics(caps), ...imuAccelMetrics(caps)]
  const eulerMetrics = imuEulerMetrics(caps)
  if (metrics.length === 0 && eulerMetrics.length === 0) return null

  return (
    // No `min-h-0` here: the card must keep its default `min-height: auto` so it
    // can never be squeezed below the numbers plus the box's own minimum. With
    // min-h-0 a short column shrinks the card past its content, which then spills
    // out and collides with the media tiles below. Growing is still fine (flex-1);
    // when there genuinely isn't room, the column scrolls instead.
    <div className="@container flex flex-1 flex-col gap-2.5 rounded-lg border bg-card px-3 py-2.5 shadow-sm">
      {metrics.length > 0 ? (
        <div
          className={`${METRIC_GRID} shrink-0`}
          style={metricGridStyle(metrics.length)}
        >
          {metrics.map((m) => (
            <MetricCell key={m} metric={m} reading={latest[m]} />
          ))}
        </div>
      ) : null}

      {eulerMetrics.length > 0 ? (
        <ImuOrientationView
          latest={latest}
          eulerMetrics={eulerMetrics}
          view={view}
        />
      ) : null}
    </div>
  )
}
