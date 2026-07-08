import { useEffect, useState } from "react"
import { ApiError, getTelemetryReadings } from "@/lib/api"
import { getTelemetryReadingsResponseSchema } from "@/lib/schemas"
import { orderMetrics } from "@/lib/telemetry-meta"
import type { HistoryPoint } from "@/hooks/use-iot-telemetry"

export interface UseTelemetryReadings {
  // Pivoted rows ({ts, [metric]: value}) already in display order (per `order`).
  history: HistoryPoint[]
  // Distinct metric keys present in the page, in canonical column order.
  metrics: string[]
  // First non-null unit seen per metric.
  units: Record<string, string>
  // Total distinct timestamps (samples) matching the filter — for pagination.
  total: number
  loading: boolean
  error: string | null
}

export interface TelemetryReadingsParams {
  from?: string
  to?: string
  order: "asc" | "desc"
  // Timestamps (samples) per page.
  limit: number
  // Timestamps to skip.
  offset: number
  // Optional comma-joined metric filter (also fixes the column set).
  metric?: string
  // Gate the fetch (e.g. until device capabilities have loaded).
  enabled?: boolean
}

// Fetches one page of raw stored readings for the Telemetry History table and
// pivots the flat {ts, metric, value} rows into table-ready points. Rows come
// back ordered by ts in the requested direction; we keep that order so the table
// renders as-is (newest- or oldest-first without an internal reverse).
export function useTelemetryReadings(
  deviceId: string,
  params: TelemetryReadingsParams
): UseTelemetryReadings {
  const { from, to, order, limit, offset, metric, enabled = true } = params

  const [state, setState] = useState<UseTelemetryReadings>({
    history: [],
    metrics: [],
    units: {},
    total: 0,
    loading: true,
    error: null,
  })

  useEffect(() => {
    // Until enabled (e.g. capabilities still loading) stay in the initial
    // loading state without a synchronous setState.
    if (!deviceId || !enabled) return
    let cancelled = false

    setState((s) => ({ ...s, loading: true, error: null }))
    ;(async () => {
      try {
        const raw = await getTelemetryReadings(deviceId, {
          from,
          to,
          order,
          limit,
          offset,
          metric: metric || undefined,
        })
        const parsed = getTelemetryReadingsResponseSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error("Unexpected /telemetry/readings response shape")
        }
        if (cancelled) return

        const byTs = new Map<number, HistoryPoint>()
        const units: Record<string, string> = {}
        const seen = new Set<string>()
        for (const r of parsed.data.readings) {
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
        // Keep the server's ts ordering so the table shows the chosen direction.
        const history = [...byTs.values()].sort((a, b) =>
          order === "asc" ? a.ts - b.ts : b.ts - a.ts
        )
        setState({
          history,
          metrics: orderMetrics([...seen]),
          units,
          total: parsed.data.page.total,
          loading: false,
          error: null,
        })
      } catch (err) {
        if (cancelled) return
        const message =
          err instanceof ApiError ? err.message : (err as Error).message
        setState((s) => ({ ...s, loading: false, error: message }))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [deviceId, enabled, from, to, order, limit, offset, metric])

  return state
}
