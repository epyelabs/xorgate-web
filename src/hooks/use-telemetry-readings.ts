import { useEffect, useState } from "react"
import { ApiError, getTelemetryTable } from "@/lib/api"
import { getTelemetryTableResponseSchema } from "@/lib/schemas"
import type { HistoryPoint } from "@/lib/telemetry-meta"

export interface UseTelemetryReadings {
  // Rows in display order (per `order`), keyed by metric for the table.
  history: HistoryPoint[]
  // Column keys in the server's order — authoritative, not page-derived.
  metrics: string[]
  // Unit per metric, from device_latest, so headers do not change as you page.
  units: Record<string, string>
  // Addressable distinct timestamps (samples) under this filter — for the pager.
  total: number
  // True when more samples match than `total` reports (the common case on the
  // default All range). `coveredFrom`/`coveredTo` bound what IS addressable.
  totalIsCapped: boolean
  coveredFrom: string | null
  coveredTo: string | null
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
  // Optional comma-joined metric filter. Omit it and the server derives the
  // column set from the device model — which is what the history table wants.
  metric?: string
}

const EMPTY: UseTelemetryReadings = {
  history: [],
  metrics: [],
  units: {},
  total: 0,
  totalIsCapped: false,
  coveredFrom: null,
  coveredTo: null,
  loading: true,
  error: null,
}

/**
 * One page of the Telemetry History table.
 *
 * The server assembles the table (`shape=table`): it owns the column set, the
 * column order and the units, and returns one row per timestamp with a
 * positional value array. This hook only widens those positional arrays into
 * the `{ts, [metric]: value}` points TelemetryTable renders.
 *
 * ⚠ It deliberately does NOT derive columns or units from the rows. That is
 * what it used to do, and it is why the header changed as you paged: a metric
 * that was all-null on the current page lost its unit, and with no metric filter
 * the table changed width. Both are now the server's answer, and the same
 * answer on every page.
 *
 * It also no longer needs the device model, so the tab renders after ONE
 * request instead of getDevice → getDeviceModel → readings.
 */
export function useTelemetryReadings(
  deviceId: string,
  params: TelemetryReadingsParams
): UseTelemetryReadings {
  const { from, to, order, limit, offset, metric } = params

  const [state, setState] = useState<UseTelemetryReadings>(EMPTY)

  useEffect(() => {
    if (!deviceId) return
    let cancelled = false

    setState((s) => ({ ...s, loading: true, error: null }))
    ;(async () => {
      try {
        const raw = await getTelemetryTable(deviceId, {
          from,
          to,
          order,
          limit,
          offset,
          metric: metric || undefined,
        })
        const parsed = getTelemetryTableResponseSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error("Unexpected /telemetry/readings response shape")
        }
        if (cancelled) return
        const { columns, rows, page } = parsed.data

        const units: Record<string, string> = {}
        for (const c of columns) if (c.unit) units[c.key] = c.unit

        // Widen each positional array. Rows arrive in the requested order, so
        // there is nothing to sort. `v[i]` is null where the sample has no
        // reading for that column — skipped, so the cell renders as "—".
        const history = rows.map((r) => {
          const point: HistoryPoint = { ts: Date.parse(r.ts) }
          for (let i = 0; i < columns.length; i += 1) {
            const value = r.v[i]
            if (value !== null && value !== undefined) point[columns[i].key] = value
          }
          return point
        })

        setState({
          history,
          metrics: columns.map((c) => c.key),
          units,
          total: page.total,
          totalIsCapped: page.totalIsCapped ?? false,
          coveredFrom: page.coveredFrom ?? null,
          coveredTo: page.coveredTo ?? null,
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
  }, [deviceId, from, to, order, limit, offset, metric])

  return state
}
