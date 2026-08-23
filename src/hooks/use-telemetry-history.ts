import { useEffect, useState } from "react"
import type { MetricName } from "@xorgate/sdk"
import { xg, xgMessage } from "@/lib/xorgate"
import type { HistoryPoint } from "@/lib/telemetry-meta"

// Aim for ~this many chart points per metric; the backend buckets server-side.
const TARGET_POINTS = 500

export interface UseTelemetryHistory {
  // Pivoted rows ({ts, [metric]: value}) sorted by ts — TelemetryChart's shape.
  history: HistoryPoint[]
  // First non-null unit seen per metric.
  units: Record<string, string>
  // [lon, lat] pairs (MapLibre order) for buckets where both gps.lat and
  // gps.lon are present, chronological.
  gpsTrack: [number, number][]
  loading: boolean
  error: string | null
  truncated: boolean
  bucketSeconds: number | null
}

// Fetches historical telemetry for [fromIso, toIso) and pivots the flat
// {ts, metric, value} rows into chart-ready points. The bucket interval is
// derived from the range so any window downsamples to ~TARGET_POINTS.
export function useTelemetryHistory(
  deviceId: string,
  fromIso: string,
  toIso: string,
  metrics: string[]
): UseTelemetryHistory {
  const [state, setState] = useState<UseTelemetryHistory>({
    history: [],
    units: {},
    gpsTrack: [],
    loading: false,
    error: null,
    truncated: false,
    bucketSeconds: null,
  })

  const metricsKey = metrics.join(",")

  useEffect(() => {
    if (!deviceId || metrics.length === 0) return
    let cancelled = false

    setState((s) => ({ ...s, loading: true, error: null }))
    ;(async () => {
      try {
        const rangeSeconds = (Date.parse(toIso) - Date.parse(fromIso)) / 1000
        const interval = Math.max(1, Math.ceil(rangeSeconds / TARGET_POINTS))
        const data = await xg().telemetry.history(deviceId, {
          from: fromIso,
          to: toIso,
          metric: metrics as MetricName[],
          interval,
        })
        if (cancelled) return

        const byTs = new Map<number, HistoryPoint>()
        const units: Record<string, string> = {}
        for (const r of data.readings) {
          if (r.value === null) continue
          const ts = Date.parse(r.ts)
          let point = byTs.get(ts)
          if (!point) {
            point = { ts }
            byTs.set(ts, point)
          }
          point[r.metric] = r.value
          if (r.unit && !(r.metric in units)) units[r.metric] = r.unit
        }
        const history = [...byTs.values()].sort((a, b) => a.ts - b.ts)
        const gpsTrack: [number, number][] = []
        for (const p of history) {
          const lat = p["gps.lat"]
          const lon = p["gps.lon"]
          if (typeof lat === "number" && typeof lon === "number") {
            gpsTrack.push([lon, lat])
          }
        }

        setState({
          history,
          units,
          gpsTrack,
          loading: false,
          error: null,
          truncated: data.truncated,
          bucketSeconds: data.bucketSeconds,
        })
      } catch (err) {
        if (cancelled) return
        setState((s) => ({ ...s, loading: false, error: xgMessage(err) }))
      }
    })()

    return () => {
      cancelled = true
    }
    // metricsKey stands in for the metrics array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, fromIso, toIso, metricsKey])

  return state
}
