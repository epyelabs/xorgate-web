import { useEffect, useState } from "react"
import type { MetricName } from "@xorgate/sdk"
import { xg, xgMessage } from "@/lib/xorgate"
import type { HistoryPoint } from "@/lib/telemetry-meta"

export interface UseRecentTelemetry {
  // Pivoted rows ({ts, [metric]: value}) sorted ascending by ts.
  history: HistoryPoint[]
  // Distinct metric keys present, sorted (stable column order for tables).
  metrics: string[]
  // First non-null unit seen per metric.
  units: Record<string, string>
  loading: boolean
  error: string | null
}

// Fetches the most recent `limit` stored readings once and pivots the flat
// {ts, metric, value} rows into chart/table-ready points. With no `metrics`
// filter it returns whatever the DB has for the device. Unlike
// useTelemetryHistory there is no time window, so it surfaces the latest samples
// even when the device last reported long ago (as long as persistence was on).
export function useRecentTelemetry(
  deviceId: string,
  metrics: string[] = [],
  limit = 1000
): UseRecentTelemetry {
  const [state, setState] = useState<UseRecentTelemetry>({
    history: [],
    metrics: [],
    units: {},
    loading: false,
    error: null,
  })

  const metricsKey = metrics.join(",")

  useEffect(() => {
    if (!deviceId) return
    let cancelled = false

    setState((s) => ({ ...s, loading: true, error: null }))
    ;(async () => {
      try {
        const data = await xg().telemetry.recent(deviceId, {
          metric: metrics.length > 0 ? (metrics as MetricName[]) : undefined,
          limit,
        })
        if (cancelled) return

        const byTs = new Map<number, HistoryPoint>()
        const units: Record<string, string> = {}
        const seen = new Set<string>()
        for (const r of data.readings) {
          if (r.value === null) continue
          const ts = Date.parse(r.ts)
          let point = byTs.get(ts)
          if (!point) {
            point = { ts }
            byTs.set(ts, point)
          }
          point[r.metric] = r.value
          seen.add(r.metric)
          if (r.unit && !(r.metric in units)) units[r.metric] = r.unit
        }
        const history = [...byTs.values()].sort((a, b) => a.ts - b.ts)
        const metricList = [...seen].sort()
        setState({
          history,
          metrics: metricList,
          units,
          loading: false,
          error: null,
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
  }, [deviceId, metricsKey, limit])

  return state
}
