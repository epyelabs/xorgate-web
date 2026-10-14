/**
 * Splitting one ask for telemetry across the calls the API will accept.
 *
 * `telemetry.history` takes at most twenty metrics per request
 * (`TelemetryHistoryParams.metric`), and the OBD-II tab alone lists twenty,
 * with GPS speed riding along on the speed panel. "Show all" on that tab is
 * therefore past the cap on its own, and trimming the list to fit would drop
 * charts the operator just asked for without a word. So the list goes out in
 * pieces instead, and the pieces are merged back into one page as if the API
 * had answered once.
 *
 * Pure functions, no React and no fetch: the query hook calls them, and the
 * unit tests assert on them directly.
 */

/** Metrics per history call, as the API accepts them. */
export const TELEMETRY_METRIC_LIMIT = 20

/**
 * `metrics` cut into consecutive runs of at most `limit`, in the order given.
 *
 * Order is kept on purpose: the pieces are independent reads of the same
 * window at the same interval, so which piece a metric lands in changes
 * nothing about its buckets, but a stable split keeps the query key stable.
 * An empty list is no calls at all, not one empty call.
 */
export function chunkMetrics<M extends string>(
  metrics: readonly M[],
  limit: number = TELEMETRY_METRIC_LIMIT
): M[][] {
  if (!Number.isInteger(limit) || limit < 1)
    throw new RangeError(`chunkMetrics: limit must be a positive integer, got ${limit}`)
  const chunks: M[][] = []
  for (let i = 0; i < metrics.length; i += limit)
    chunks.push(metrics.slice(i, i + limit))
  return chunks
}

/** The shape every history page shares, whatever its reading rows carry. */
export interface HistoryPage<Reading = unknown> {
  readings?: Reading[] | null
  bucketSeconds?: number | null
  truncated?: boolean | null
}

/**
 * Several pages for the same window, as one.
 *
 * Readings are concatenated in page order. Every page was asked for the same
 * `interval`, so they echo the same bucket width and the first one's stands
 * for all; `truncated` is OR-ed, since one page hitting the row cap means the
 * whole is incomplete, and saying otherwise would hide a missing stretch.
 */
export function mergeHistoryPages<Reading>(
  pages: readonly HistoryPage<Reading>[]
): { readings: Reading[]; bucketSeconds: number | null; truncated: boolean } {
  return {
    readings: pages.flatMap((p) => p.readings ?? []),
    bucketSeconds: pages.find((p) => p.bucketSeconds != null)?.bucketSeconds ?? null,
    truncated: pages.some((p) => p.truncated === true),
  }
}
