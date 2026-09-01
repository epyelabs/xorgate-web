import { useMemo } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { MetricName, TelemetryTablePage } from "@xorgate/sdk"
import { xg, xgMessage } from "@/lib/xorgate"
import type { HistoryPoint } from "@/lib/telemetry-meta"
import { qk } from "@/queries/keys"
import { useTenant } from "@/queries/tenant"

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

// Module-scope so react-query can memoize the transform across renders.
// Widens each row's positional value array into the `{ts, [metric]: value}`
// points TelemetryTable renders; columns/units are the SERVER's answer, so
// the header cannot change as you page (see the hook comment).
function widen(data: TelemetryTablePage) {
  const { columns, rows, page } = data

  const units: Record<string, string> = {}
  for (const c of columns) if (c.unit) units[c.key] = c.unit

  // Rows arrive in the requested order, so there is nothing to sort. `v[i]`
  // is null where the sample has no reading for that column — skipped, so the
  // cell renders as "—".
  const history = rows.map((r) => {
    const point: HistoryPoint = { ts: Date.parse(r.ts) }
    for (let i = 0; i < columns.length; i += 1) {
      const value = r.v[i]
      if (value !== null && value !== undefined) point[columns[i].key] = value
    }
    return point
  })

  return {
    history,
    metrics: columns.map((c) => c.key),
    units,
    total: page.total,
    totalIsCapped: page.totalIsCapped ?? false,
    coveredFrom: page.coveredFrom ?? null,
    coveredTo: page.coveredTo ?? null,
  }
}

const EMPTY: ReturnType<typeof widen> = {
  history: [],
  metrics: [],
  units: {},
  total: 0,
  totalIsCapped: false,
  coveredFrom: null,
  coveredTo: null,
}

/**
 * One page of the Telemetry History table.
 *
 * The server assembles the table (`shape=table`): it owns the column set, the
 * column order and the units, and returns one row per timestamp with a
 * positional value array; `widen()` above is the only client-side step.
 *
 * Cached per (device, filter) and carried across filter changes with
 * `keepPreviousData`: paging or reordering keeps the current rows on screen
 * while the next page loads behind them, instead of flashing the loading
 * table — and a page you have already visited renders instantly from cache.
 */
export function useTelemetryReadings(
  deviceId: string,
  params: TelemetryReadingsParams
): UseTelemetryReadings {
  const { from, to, order, limit, offset, metric } = params
  const { orgId, wsId, ready } = useTenant()

  const query = useQuery({
    queryKey: qk.telemetryReadings(orgId, wsId, deviceId, {
      from,
      to,
      order,
      limit,
      offset,
      metric,
    }),
    queryFn: () =>
      xg().telemetry.readings(deviceId, {
        from,
        to,
        order,
        limit,
        offset,
        metric: metric ? (metric.split(",") as MetricName[]) : undefined,
      }),
    enabled: ready && !!deviceId,
    select: widen,
    placeholderData: keepPreviousData,
  })

  return useMemo(() => {
    const data = query.data ?? EMPTY
    return {
      ...data,
      // Pending only with nothing at all to show; a filter change over held
      // rows is not a loading state.
      loading: query.isPending,
      error: !query.data && query.error ? xgMessage(query.error) : null,
    }
  }, [query.data, query.isPending, query.error])
}
