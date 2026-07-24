// TEMPORARY Phase 4 verification harness — an in-page stand-in for
// GET /devices/{id}/telemetry, faithful to handlers/telemetry-history.ts
// semantics (range [from,to), metric filter, epoch bucketing with avg/min(unit),
// raw 5000-row cap / bucketed 10000-row cap with `truncated`), fed from a
// DB-dumped raw-rows file so responses are byte-honest ground truth. Latency is
// injected to exercise the hook's prefetch-ahead behavior; every call is logged
// (params, rows, body bytes, service time) for the R4 measurements.
import type { TelemetryHistoryResponse, TelemetryReadingRow } from "@/lib/api"

export interface RawDump {
  from: number
  to: number
  rows: TelemetryReadingRow[]
}

export interface TelemetryCall {
  from: string
  to: string
  metric?: string
  interval?: number
  rows: number
  truncated: boolean
  bytes: number
  serviceMs: number
  at: number
}

const RAW_LIMIT = 5_000
const BUCKETED_LIMIT = 10_000

interface ParsedRow {
  tsMs: number
  metric: string
  value: number
  unit: string | null
}

export function makeFetchTelemetry(
  dump: RawDump,
  { latencyMs = 400, log }: { latencyMs?: number; log?: TelemetryCall[] } = {}
) {
  // Parse once; rows arrive (ts asc, metric asc) from the dump query.
  const rows: ParsedRow[] = []
  for (const r of dump.rows) {
    if (r.value === null) continue
    rows.push({
      tsMs: Date.parse(r.ts),
      metric: r.metric,
      value: r.value,
      unit: r.unit,
    })
  }

  return async (
    _deviceId: string,
    params: { from: string; to: string; metric?: string; interval?: number }
  ): Promise<TelemetryHistoryResponse> => {
    const started = performance.now()
    const fromMs = Date.parse(params.from)
    const toMs = Date.parse(params.to)
    const metrics = params.metric ? new Set(params.metric.split(",")) : null
    const inRange = rows.filter(
      (r) =>
        r.tsMs >= fromMs && r.tsMs < toMs && (!metrics || metrics.has(r.metric))
    )

    let readings: TelemetryReadingRow[]
    let truncated: boolean
    let bucketSeconds: number | null

    if (params.interval !== undefined) {
      bucketSeconds = params.interval
      const bMs = params.interval * 1000
      const acc = new Map<
        string,
        { bucket: number; metric: string; sum: number; n: number; unit: string | null }
      >()
      for (const r of inRange) {
        const bucket = Math.floor(r.tsMs / bMs) * bMs
        const key = `${bucket}|${r.metric}`
        const a = acc.get(key)
        if (a) {
          a.sum += r.value
          a.n++
          if (a.unit === null || (r.unit !== null && r.unit < a.unit)) a.unit = r.unit
        } else {
          acc.set(key, { bucket, metric: r.metric, sum: r.value, n: 1, unit: r.unit })
        }
      }
      const buckets = [...acc.values()].sort(
        (a, b) => a.bucket - b.bucket || (a.metric < b.metric ? -1 : 1)
      )
      truncated = buckets.length > BUCKETED_LIMIT
      readings = buckets.slice(0, BUCKETED_LIMIT).map((b) => ({
        ts: new Date(b.bucket).toISOString(),
        metric: b.metric,
        value: b.sum / b.n,
        unit: b.unit,
      }))
    } else {
      bucketSeconds = null
      truncated = inRange.length > RAW_LIMIT
      readings = inRange.slice(0, RAW_LIMIT).map((r) => ({
        ts: new Date(r.tsMs).toISOString(),
        metric: r.metric,
        value: r.value,
        unit: r.unit,
      }))
    }

    const body: TelemetryHistoryResponse = { readings, bucketSeconds, truncated }
    const serviceMs = performance.now() - started
    log?.push({
      from: params.from,
      to: params.to,
      metric: params.metric,
      interval: params.interval,
      rows: readings.length,
      truncated,
      bytes: JSON.stringify(body).length,
      serviceMs,
      at: performance.now(),
    })
    await new Promise((r) => setTimeout(r, latencyMs))
    return body
  }
}
