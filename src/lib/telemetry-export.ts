import type { TelemetryTablePage } from "@/lib/api"
import { formatUnit, metricLabel } from "@/lib/telemetry-meta"

/**
 * CSV export for the Telemetry History table.
 *
 * ⚠ This pages by TIME, not by `offset`, and that is the whole point of the
 * module. Two independent defects come from offset paging this endpoint:
 *
 * 1. **The server's `total` is capped.** `/telemetry/readings` bounds its
 *    distinct-timestamp count at `READINGS_TOTAL_CAP` (10 000) because an exact
 *    count over 8.3 M rows costs > 45 s. An export whose stopping condition is
 *    `page.total` therefore stops at 10 000 rows no matter how much history the
 *    device has, and offsets past the cap short-circuit to an empty page.
 * 2. **The window slides underneath the pager.** The device ingests at 1 Hz
 *    throughout a ~45 s export, so `offset` addresses a *different* row on every
 *    request: rows shift toward older offsets as new samples land at the head,
 *    which both re-reads and skips. Measured on dev before this change: 20
 *    requests over a claimed 10 000 rows produced **9 960** — the missing 40 are
 *    samples that slid across a page boundary mid-export.
 *
 * Advancing a time cursor instead fixes both. Each request asks for the newest
 * `pageLimit` samples strictly older than the previous batch's oldest (or, for
 * `order=asc`, the oldest newer than its newest), so the walk is a consistent
 * snapshot moving away from the moving end of the data. `from`/`to` are already
 * part of the endpoint's contract, so this needs no API change — it is keyset
 * pagination scoped to the one caller that genuinely has to walk everything.
 *
 * ⚠ **The cursor overlaps by one millisecond, deliberately.** Wire timestamps
 * are `Date#toISOString()`, i.e. millisecond-truncated, so a cursor cannot
 * address a sub-millisecond boundary at all. Rather than assume ms-aligned
 * storage (it is ms-aligned today — every ingest path builds `ts` from a JS
 * `Date`, and 300 000 sampled rows spanning all of dev's history contain zero
 * sub-ms values), the cursor re-includes the boundary millisecond and the
 * pivot map dedupes it. The cost is one redundant timestamp per batch (~0.2 %);
 * the alternative silently drops rows the day storage gains microseconds.
 *
 * The export is still bounded — `TELEMETRY_EXPORT_CAP` rows — but that bound is
 * now the export's own, is reported honestly, and is reachable in full. It is
 * no longer a server-side cap leaking through a stopping condition.
 *
 * It walks the endpoint's TABLE shape (`shape=table`), which is what made a
 * 20 000-row export affordable: the flat shape repeats the metric key, the unit
 * and a re-serialised ISO timestamp once per reading, and this API does not
 * compress. Only the fetch callback and this loop know the difference — the
 * cursor logic below is shape-agnostic.
 */

/** Rows (timestamps) an export will write before it stops and warns. */
export const TELEMETRY_EXPORT_CAP = 20_000

/** Timestamps per request. `READINGS_MAX_LIMIT` on the server. */
export const EXPORT_PAGE_LIMIT = 500

/**
 * Hard stop on request count, so a cursor that fails to advance can never spin.
 * The cap needs ~41 requests at `EXPORT_PAGE_LIMIT` (one timestamp per batch is
 * the overlap), plus one terminating empty page; the rest is headroom.
 */
const MAX_REQUESTS = 60

/** One exported sample: an epoch-ms timestamp and its metric values. */
export interface ExportPoint {
  ts: number
  values: Record<string, number>
}

export interface TelemetryExport {
  /** Samples in `order`, at most `cap` of them. */
  points: ExportPoint[]
  /** First non-null unit seen per metric, across the whole export. */
  units: Record<string, string>
  /**
   * The server's column keys, in its order — the same set the table displays,
   * including columns that happened to be all-null over the exported window.
   */
  columns: string[]
  /** True when the walk stopped on a limit rather than on the end of the data. */
  capped: boolean
  /** Requests actually issued — measured, for the record. */
  requests: number
}

export interface CollectTelemetryOptions {
  order: "asc" | "desc"
  /** The user's window, if any. The bound the cursor does not move stays fixed. */
  from?: string
  to?: string
  cap?: number
  pageLimit?: number
}

type FetchPage = (params: {
  from?: string
  to?: string
  limit: number
  order: "asc" | "desc"
}) => Promise<TelemetryTablePage>

/**
 * Walk every sample matching the current filter, newest-first (`desc`) or
 * oldest-first (`asc`), up to `cap` timestamps.
 *
 * `fetchPage` is injected so the walk is testable without a network: it is
 * `getTelemetryTable` bound to a device at the call site. No metric filter is
 * sent — the server derives the column set from the device model, the same set
 * the table displays.
 *
 * ⚠ `offset` is never sent. The server's bounded `total` is ignored entirely —
 * reading it back would reintroduce the cap this function exists to escape.
 */
export async function collectTelemetryForExport(
  fetchPage: FetchPage,
  opts: CollectTelemetryOptions,
): Promise<TelemetryExport> {
  const { order, from, to } = opts
  const cap = opts.cap ?? TELEMETRY_EXPORT_CAP
  const pageLimit = opts.pageLimit ?? EXPORT_PAGE_LIMIT

  const byTs = new Map<number, Record<string, number>>()
  const units: Record<string, string> = {}
  // The server's column set. Stable across the walk (it is derived from the
  // device model, not from the page), so last-writer-wins is fine; it is read
  // from every response only so an empty first page cannot leave it unset.
  let columns: string[] = []

  // The moving bound. `desc` walks backwards by pulling `to` down; `asc` walks
  // forwards by pushing `from` up. The other bound is the user's and never moves.
  let cursorTo = to
  let cursorFrom = from
  let capped = false
  let requests = 0

  while (true) {
    if (requests >= MAX_REQUESTS) {
      capped = true
      break
    }
    const res = await fetchPage({
      from: cursorFrom,
      to: cursorTo,
      limit: pageLimit,
      order,
    })
    requests += 1

    if (res.columns.length > 0) columns = res.columns.map((c) => c.key)
    for (const c of res.columns) {
      if (c.unit && !(c.key in units)) units[c.key] = c.unit
    }

    let oldest = Number.POSITIVE_INFINITY
    let newest = Number.NEGATIVE_INFINITY
    for (const r of res.rows) {
      const ts = Date.parse(r.ts)
      if (Number.isNaN(ts)) continue
      if (ts < oldest) oldest = ts
      if (ts > newest) newest = ts
      let point = byTs.get(ts)
      if (!point) {
        point = {}
        byTs.set(ts, point)
      }
      // `v` is positional against `res.columns`. A null marks its timestamp as
      // visited (so the cursor moves past it) but contributes no cell, exactly
      // as the on-screen table treats it.
      for (let i = 0; i < res.columns.length; i += 1) {
        const value = r.v[i]
        if (value !== null && value !== undefined) point[res.columns[i].key] = value
      }
    }

    // End of the data in the walk direction — nothing left, or nothing with a
    // usable timestamp to advance the cursor to.
    if (res.rows.length === 0 || oldest === Number.POSITIVE_INFINITY) break

    // Reaching the cap and the data ending on exactly the cap are
    // indistinguishable without one more request. We warn, because over-warning
    // on an exact tie is cheap and under-warning is the defect this fixes.
    if (byTs.size >= cap) {
      capped = true
      break
    }

    // Advance. `to` is exclusive server-side and `from` inclusive, so `desc`
    // adds the 1 ms and `asc` needs none — both land on a bound that re-includes
    // the boundary millisecond (see the header comment).
    const nextTo = order === "desc" ? new Date(oldest + 1).toISOString() : cursorTo
    const nextFrom = order === "asc" ? new Date(newest).toISOString() : cursorFrom

    // The cursor must strictly narrow the window. If it did not, the batch
    // returned nothing beyond the boundary millisecond it was already given, so
    // asking again would repeat this request forever. This is the sole
    // termination guarantee — do not weaken it to a row-count check, which an
    // all-null batch would trip by accident.
    if (order === "desc" ? nextTo === cursorTo : nextFrom === cursorFrom) break
    cursorTo = nextTo
    cursorFrom = nextFrom
  }

  const tsList = [...byTs.keys()].sort((a, b) => (order === "asc" ? a - b : b - a))
  // Trim to exactly `cap` so the warning names a real number: a batch overshoots
  // by up to pageLimit-1 rows, and "capped at 20,000" should mean 20 000.
  const kept = tsList.length > cap ? tsList.slice(0, cap) : tsList

  return {
    points: kept.map((ts) => ({ ts, values: byTs.get(ts)! })),
    units,
    columns,
    capped,
    requests,
  }
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/**
 * Render an export as CSV.
 *
 * `columns` is the on-screen column set, so the file's headers and their order
 * match the table exactly. It is passed in rather than derived from the data for
 * that reason; the export's own column list (also server-supplied) is the
 * fallback when the caller has none.
 */
export function buildTelemetryCsv(
  result: Pick<TelemetryExport, "points" | "units" | "columns">,
  columns: string[],
): string {
  const cols = columns.length ? columns : result.columns
  const header = [
    "Time",
    ...cols.map(
      (m) =>
        metricLabel(m) +
        (result.units[m] ? ` (${formatUnit(result.units[m])})` : ""),
    ),
  ]
  const lines = [header.map(csvCell).join(",")]
  for (const point of result.points) {
    const row = [
      new Date(point.ts).toISOString(),
      ...cols.map((m) =>
        typeof point.values[m] === "number" ? String(point.values[m]) : "",
      ),
    ]
    lines.push(row.map(csvCell).join(","))
  }
  return lines.join("\n")
}
