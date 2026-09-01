import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import type { MetricName, TelemetryHistory } from "@xorgate/sdk"
import { xg, xgMessage } from "@/lib/xorgate"
import type { HistoryPoint } from "@/lib/telemetry-meta"
import { qk } from "@/queries/keys"
import { useTenant } from "@/queries/tenant"

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

// Module-scope so react-query can memoize the transform across renders.
function pivot(data: TelemetryHistory) {
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
  return {
    history: [...byTs.values()].sort((a, b) => a.ts - b.ts),
    metrics: [...seen].sort(),
    units,
  }
}

const EMPTY: ReturnType<typeof pivot> = { history: [], metrics: [], units: {} }

// Fetches the most recent `limit` stored readings and pivots the flat
// {ts, metric, value} rows into chart/table-ready points. With no `metrics`
// filter it returns whatever the DB has for the device. Unlike
// useTelemetryHistory there is no time window, so it surfaces the latest
// samples even when the device last reported long ago (as long as persistence
// was on). Cached per device: revisiting the Overview inside staleTime costs
// nothing, and after it the cached rows render while the refetch runs behind.
export function useRecentTelemetry(
  deviceId: string,
  metrics: string[] = [],
  limit = 1000
): UseRecentTelemetry {
  const { orgId, wsId, ready } = useTenant()
  const metricsKey = metrics.join(",")

  const query = useQuery({
    queryKey: qk.telemetryRecent(orgId, wsId, deviceId, metricsKey, limit),
    queryFn: () =>
      xg().telemetry.recent(deviceId, {
        metric:
          metricsKey.length > 0
            ? (metricsKey.split(",") as MetricName[])
            : undefined,
        limit,
      }),
    enabled: ready && !!deviceId,
    select: pivot,
  })

  return useMemo(() => {
    const data = query.data ?? EMPTY
    return {
      ...data,
      loading: query.isPending,
      // A failed background refetch keeps the last good rows on screen.
      error: !query.data && query.error ? xgMessage(query.error) : null,
    }
  }, [query.data, query.isPending, query.error])
}
