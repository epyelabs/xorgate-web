import type { LatestReading } from "@xorgate/sdk"
import { JsonPanelShell, StatusDot } from "@/components/json-panel"

/**
 * Raw View's JSON pane on the REPLAY tab.
 *
 * ⚠ This is deliberately NOT the same thing the live tab shows, and the header
 * says so. Replay telemetry comes from `GET /devices/{id}/telemetry`, which
 * serves `telemetry_readings` rows — flat `{ts, metric, value, unit}` records
 * that were already flattened from the device's payloads on the way in. The
 * original wire frames are not stored anywhere and cannot be reconstructed, so
 * there is no `v`/`deviceId`/`seq` and no `metrics` group nesting to show.
 *
 * What it renders instead is the reading set resolved AT THE PLAYHEAD: the
 * SDK's `LatestByMetric` interop shape, keyed by the flat `group.field` metric
 * names. Presenting that re-nested as a fake payload would look like a frame
 * while actually being a merged, interpolated view, which is exactly the
 * confusion this view exists to remove.
 */
export function ReplayJsonPanel({
  latest,
  playheadTs,
  loading,
}: {
  latest: Record<string, LatestReading>
  /** Epoch ms of the current playhead. */
  playheadTs: number
  loading: boolean
}) {
  const count = Object.keys(latest).length

  return (
    <JsonPanelShell
      value={count > 0 ? latest : null}
      // Depth 2 suits this shape: the map is one level of metric keys, each
      // holding a small leaf object, so everything is visible at once.
      openDepth={2}
      header={
        <>
          <span className="flex items-center gap-1.5 font-medium">
            <StatusDot
              className={loading ? "bg-amber-400" : "bg-sky-500"}
              pulse={loading}
            />
            {loading ? "Loading" : "Recorded readings"}
          </span>
          <span
            className="truncate text-muted-foreground"
            title="Replay serves stored readings, not the device's original payloads — those are not retained."
          >
            at playhead · not a wire frame
          </span>
          <span className="ml-auto flex items-center gap-3 text-muted-foreground">
            <span>{count} metrics</span>
            <span className="hidden sm:inline">
              {new Date(playheadTs).toISOString()}
            </span>
          </span>
        </>
      }
      empty={
        loading
          ? "Loading recorded telemetry…"
          : "No readings recorded at this point in the replay."
      }
    />
  )
}
