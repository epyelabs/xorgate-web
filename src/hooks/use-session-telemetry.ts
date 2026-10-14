import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { MetricName, TelemetryHistory } from "@xorgate/sdk"
import { chunkMetrics, mergeHistoryPages } from "@/lib/telemetry-batch"
import { xg } from "@/lib/xorgate"
import { qk } from "@/queries/keys"
import { useTenant } from "@/queries/tenant"

/**
 * Buckets a replay is averaged into.
 *
 * Not a fixed width: a 4-minute run and a 3-hour one both have to end up with
 * a workable number of points. 400 is a few hundred pixels' worth of plot,
 * which is roughly the width a panel in this sheet has to draw it with.
 */
const TARGET_BUCKETS = 400

/** Bucket width, in whole seconds, that fits `span` into that budget. */
export function telemetryInterval(fromMs: number, toMs: number): number {
  const spanSeconds = (toMs - fromMs) / 1000
  if (!Number.isFinite(spanSeconds) || spanSeconds <= 0) return 1
  return Math.max(1, Math.ceil(spanSeconds / TARGET_BUCKETS))
}

/** One bucket: the wall-clock instant, plus each metric's average in it. */
export type TelemetrySample = { t: number } & Record<string, number | null>

export interface SessionTelemetry {
  samples: TelemetrySample[]
  /** Metrics that actually reported inside the window, in request order. */
  present: string[]
  bucketSeconds: number | null
  /** The row cap was hit: what is drawn is real but INCOMPLETE. */
  truncated: boolean
}

/**
 * Every requested metric over the window, in as many calls as the API's
 * per-request cap needs (`chunkMetrics`), never trimmed to fit.
 *
 * The chunks are independent reads of the same window at the same interval, so
 * their buckets land on the same instants and the pivot below merges them into
 * one row per bucket with no interpolation. `truncated` is OR-ed: one chunk
 * hitting the row cap means the result as a whole is incomplete.
 */
async function fetchHistory(
  deviceId: string,
  from: string,
  to: string,
  metrics: string[],
  interval: number,
  signal: AbortSignal
): Promise<TelemetryHistory> {
  const pages = await Promise.all(
    chunkMetrics(metrics as MetricName[]).map((metric) =>
      xg().telemetry.history(deviceId, { from, to, metric, interval, signal })
    )
  )
  return mergeHistoryPages(pages)
}

/** Long, flat readings → one row per bucket, keyed by metric. */
function pivot(history: TelemetryHistory, metrics: string[]): SessionTelemetry {
  const byBucket = new Map<number, TelemetrySample>()
  const present = new Set<string>()
  for (const reading of history.readings ?? []) {
    if (reading.value === null || reading.value === undefined) continue
    const t = Date.parse(reading.ts)
    if (Number.isNaN(t)) continue
    let row = byBucket.get(t)
    if (!row) {
      row = { t }
      byBucket.set(t, row)
    }
    row[reading.metric] = Number(reading.value)
    present.add(reading.metric)
  }
  // Every row carries every metric, missing ones explicitly null: a hole in
  // one metric must BREAK its line rather than let Recharts bridge the stretch
  // where the device said nothing.
  const samples = [...byBucket.values()].sort((a, b) => a.t - b.t)
  for (const row of samples) {
    for (const metric of present) if (!(metric in row)) row[metric] = null
  }
  return {
    samples,
    present: metrics.filter((m) => present.has(m)),
    bucketSeconds: history.bucketSeconds ?? null,
    truncated: history.truncated ?? false,
  }
}

/**
 * A replay window's telemetry, pivoted into one row per bucket.
 *
 * `metrics` is exactly the set the caller wants drawn, and it is part of the
 * key: the trends sheet asks only for the lines that are switched on, so a
 * chip is a round trip, and the API is never asked for twenty charts to show
 * four. Past the per-call cap the ask goes out in pieces (`chunkMetrics`) and
 * comes back as one page; nothing is trimmed to fit. `keepPreviousData` keeps
 * the charts already drawn on screen while the larger set loads, so a toggle
 * adds a line rather than blanking the sheet.
 */
export function useSessionTelemetry(
  deviceId: string,
  window: { from: number; to: number } | null,
  metrics: string[],
  { enabled = true }: { enabled?: boolean } = {}
) {
  const { orgId, wsId, ready } = useTenant()
  const interval = window ? telemetryInterval(window.from, window.to) : 1
  const metricKey = [...metrics].sort().join(",")

  return useQuery({
    queryKey: qk.telemetryHistory(
      orgId,
      wsId,
      deviceId,
      window ? `${window.from}:${window.to}` : "none",
      metricKey,
      interval
    ),
    queryFn: ({ signal }) =>
      fetchHistory(
        deviceId,
        new Date(window!.from).toISOString(),
        new Date(window!.to).toISOString(),
        metrics,
        interval,
        signal
      ),
    enabled: enabled && ready && !!deviceId && window !== null && metrics.length > 0,
    // A closed recording's history does not change, and an open one's tail is
    // not what this sheet is for. Re-opening it inside a visit costs nothing.
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    select: (history) => pivot(history, metrics),
  })
}
