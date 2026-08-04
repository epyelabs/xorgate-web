import { describe, expect, it } from "vitest"

import type { TelemetryReadingRow, TelemetryReadingsPage } from "@/lib/api"
import {
  TELEMETRY_EXPORT_CAP,
  type TelemetryExport,
  buildTelemetryCsv,
  collectTelemetryForExport,
} from "@/lib/telemetry-export"

// A stand-in for GET /devices/{id}/telemetry/readings that reproduces the
// handler's semantics exactly, because the export's correctness turns on them:
//
//   - `from` is INCLUSIVE (ts >= from), `to` is EXCLUSIVE (ts < to)
//   - `limit` counts DISTINCT TIMESTAMPS, not rows
//   - `page.total` is bounded at READINGS_TOTAL_CAP and `totalIsCapped` says so
//
// (backend src/handlers/telemetry-history.ts handleReadings + services/
// telemetry-readings.ts). Anything the fake gets wrong here, the tests get wrong.
const SERVER_TOTAL_CAP = 10_000

interface FakeServer {
  fetchPage: Parameters<typeof collectTelemetryForExport>[0]
  /** Query log, so tests can assert on the cursor rather than only the result. */
  calls: Array<{ from?: string; to?: string; limit: number; order: "asc" | "desc" }>
  /** Samples, keyed by epoch ms; mutated by tests that simulate live ingest. */
  samples: Map<number, Record<string, number | null>>
}

function makeServer(
  samples: Map<number, Record<string, number | null>>,
  hooks: { beforeEach?: (calls: number) => void } = {},
): FakeServer {
  const calls: FakeServer["calls"] = []

  const fetchPage = async (params: {
    from?: string
    to?: string
    limit: number
    order: "asc" | "desc"
  }): Promise<TelemetryReadingsPage> => {
    hooks.beforeEach?.(calls.length)
    calls.push(params)

    const fromMs = params.from ? Date.parse(params.from) : -Infinity
    const toMs = params.to ? Date.parse(params.to) : Infinity
    const matching = [...samples.keys()]
      .filter((ts) => ts >= fromMs && ts < toMs)
      .sort((a, b) => (params.order === "asc" ? a - b : b - a))

    const pageTs = matching.slice(0, params.limit)
    const readings: TelemetryReadingRow[] = []
    for (const ts of pageTs) {
      for (const [metric, value] of Object.entries(samples.get(ts)!)) {
        readings.push({
          ts: new Date(ts).toISOString(),
          metric,
          value,
          unit: metric.startsWith("imu.") ? "m/s^2" : "%",
        })
      }
    }
    const rawTotal = matching.length
    return {
      readings,
      page: {
        limit: params.limit,
        offset: 0,
        order: params.order,
        total: Math.min(rawTotal, SERVER_TOTAL_CAP),
        totalIsCapped: rawTotal > SERVER_TOTAL_CAP,
      },
    }
  }

  return { fetchPage, calls, samples }
}

/** `count` samples one second apart, newest at `startMs`. */
function series(
  count: number,
  startMs = Date.parse("2026-08-04T12:00:00.000Z"),
): Map<number, Record<string, number | null>> {
  const out = new Map<number, Record<string, number | null>>()
  for (let i = 0; i < count; i++) {
    const ts = startMs - i * 1000
    out.set(ts, { "imu.accel_x": i, "system.cpu_usage": i / 2 })
  }
  return out
}

describe("collectTelemetryForExport", () => {
  it("walks every sample with a descending time cursor, no gaps and no duplicates", async () => {
    const srv = makeServer(series(1250))
    const res = await collectTelemetryForExport(srv.fetchPage, {
      order: "desc",
      pageLimit: 500,
    })

    expect(res.points).toHaveLength(1250)
    expect(res.capped).toBe(false)
    // Strictly descending, so no timestamp is repeated or transposed.
    const ts = res.points.map((p) => p.ts)
    expect(ts).toEqual([...ts].sort((a, b) => b - a))
    expect(new Set(ts).size).toBe(1250)
    expect(ts).toEqual([...srv.samples.keys()].sort((a, b) => b - a))
  })

  it("moves only `to` when descending, and re-includes the boundary millisecond", async () => {
    const srv = makeServer(series(1250))
    await collectTelemetryForExport(srv.fetchPage, {
      order: "desc",
      from: "2026-08-01T00:00:00.000Z",
      pageLimit: 500,
    })

    // The user's `from` is theirs and never moves.
    expect(srv.calls.every((c) => c.from === "2026-08-01T00:00:00.000Z")).toBe(true)
    expect(srv.calls[0].to).toBeUndefined()
    // `to` is exclusive, so the next bound is oldest + 1 ms: the boundary sample
    // comes back a second time and is deduped rather than risking a skip.
    expect(srv.calls[1].to).toBe(
      new Date(Date.parse("2026-08-04T12:00:00.000Z") - 499 * 1000 + 1).toISOString(),
    )
    // Strictly narrowing.
    const tos = srv.calls.slice(1).map((c) => Date.parse(c.to!))
    expect(tos).toEqual([...tos].sort((a, b) => b - a))
    expect(new Set(tos).size).toBe(tos.length)
  })

  it("moves only `from` when ascending", async () => {
    const srv = makeServer(series(1250))
    const res = await collectTelemetryForExport(srv.fetchPage, {
      order: "asc",
      to: "2026-08-09T00:00:00.000Z",
      pageLimit: 500,
    })

    expect(res.points).toHaveLength(1250)
    expect(srv.calls.every((c) => c.to === "2026-08-09T00:00:00.000Z")).toBe(true)
    expect(srv.calls[0].from).toBeUndefined()
    // `from` is inclusive, so the boundary sample is the next bound as-is.
    const oldest = Math.min(...srv.samples.keys())
    expect(srv.calls[1].from).toBe(new Date(oldest + 499 * 1000).toISOString())
    const ts = res.points.map((p) => p.ts)
    expect(ts).toEqual([...ts].sort((a, b) => a - b))
    expect(new Set(ts).size).toBe(1250)
  })

  it("ignores the server's capped `total` and walks past it", async () => {
    // 12 000 samples — more than SERVER_TOTAL_CAP, so every early request comes
    // back with total = 10 000 and totalIsCapped = true. Offset paging stopped
    // there and wrote a 10 000-row file; the time cursor must not.
    const srv = makeServer(series(12_000))
    const res = await collectTelemetryForExport(srv.fetchPage, {
      order: "desc",
      pageLimit: 500,
    })

    expect(srv.calls.length).toBeGreaterThan(20) // offset paging died at 20
    expect(res.points.length).toBe(12_000)
    expect(res.capped).toBe(false)
  })

  // THE regression test. Offset paging produced 9 960 of a claimed 10 000 live,
  // because the device ingests at 1 Hz for the ~45 s the export runs: every new
  // sample at the head shifts the whole history one offset older, so a row that
  // was at offset 999 is at offset 1000 by the next request and is never read.
  // A descending time cursor is immune — it walks away from the moving end.
  it("loses nothing when new samples land at the head mid-export", async () => {
    const samples = series(1250)
    let head = Math.max(...samples.keys())
    const original = new Set(samples.keys())

    // 40 fresh samples per request, as if the device kept reporting.
    const srv = makeServer(samples, {
      beforeEach: () => {
        for (let i = 0; i < 40; i++) {
          head += 1000
          samples.set(head, { "imu.accel_x": -1, "system.cpu_usage": -1 })
        }
      },
    })

    const res = await collectTelemetryForExport(srv.fetchPage, {
      order: "desc",
      pageLimit: 500,
    })

    const got = new Set(res.points.map((p) => p.ts))
    // Every sample that existed when the export started is in the file.
    for (const ts of original) expect(got.has(ts)).toBe(true)
    expect(got.size).toBe(res.points.length) // no duplicates
  })

  it("stops at the cap, trims to exactly it, and reports capped", async () => {
    const srv = makeServer(series(5000))
    const res = await collectTelemetryForExport(srv.fetchPage, {
      order: "desc",
      pageLimit: 500,
      cap: 1200,
    })

    expect(res.capped).toBe(true)
    // A batch overshoots by up to pageLimit-1; the file must still be exactly
    // the number the warning names.
    expect(res.points).toHaveLength(1200)
    // And they are the newest 1200, contiguously.
    const newest = Math.max(...srv.samples.keys())
    expect(res.points[0].ts).toBe(newest)
    expect(res.points[1199].ts).toBe(newest - 1199 * 1000)
  })

  it("terminates when the cursor cannot narrow further", async () => {
    // One timestamp, forever. `to = ts + 1ms` returns it again and again; the
    // walk must notice the bound stopped moving instead of spinning.
    const ts = Date.parse("2026-08-04T12:00:00.000Z")
    const srv = makeServer(new Map([[ts, { "imu.accel_x": 1 }]]))
    const res = await collectTelemetryForExport(srv.fetchPage, {
      order: "desc",
      pageLimit: 500,
    })

    expect(res.points).toHaveLength(1)
    expect(srv.calls.length).toBe(2)
    expect(res.capped).toBe(false)
  })

  it("terminates on an all-null batch without dropping the walk early", async () => {
    // A metric that is null for the newest 600 samples and present below: the
    // cursor must keep going rather than treat "no rows added" as the end.
    const samples = series(1200)
    let i = 0
    for (const ts of [...samples.keys()].sort((a, b) => b - a)) {
      if (i++ < 600) samples.set(ts, { "imu.accel_x": null })
    }
    const srv = makeServer(samples)
    const res = await collectTelemetryForExport(srv.fetchPage, {
      order: "desc",
      pageLimit: 500,
    })

    expect(res.points).toHaveLength(600)
    expect(res.capped).toBe(false)
  })

  it("returns an empty export when nothing matches", async () => {
    const srv = makeServer(new Map())
    const res = await collectTelemetryForExport(srv.fetchPage, { order: "desc" })

    expect(res.points).toEqual([])
    expect(res.capped).toBe(false)
    expect(srv.calls).toHaveLength(1)
  })

  it("caps the request count so a pathological server cannot spin", async () => {
    // Every request returns one fresh, strictly older timestamp — the cursor
    // always advances, so only MAX_REQUESTS can stop it.
    let ts = Date.parse("2026-08-04T12:00:00.000Z")
    const fetchPage = async () => {
      ts -= 1000
      return {
        readings: [
          { ts: new Date(ts).toISOString(), metric: "imu.accel_x", value: 1, unit: null },
        ],
        page: { limit: 500, offset: 0, order: "desc" as const, total: 1 },
      }
    }
    const res = await collectTelemetryForExport(fetchPage, {
      order: "desc",
      pageLimit: 500,
    })

    expect(res.requests).toBe(60)
    expect(res.capped).toBe(true)
  })

  it("collects units across the whole export, not just the first page", async () => {
    const srv = makeServer(series(600))
    const res = await collectTelemetryForExport(srv.fetchPage, {
      order: "desc",
      pageLimit: 500,
    })

    expect(res.units["imu.accel_x"]).toBe("m/s^2")
    expect(res.units["system.cpu_usage"]).toBe("%")
    expect(res.metrics).toEqual(["imu.accel_x", "system.cpu_usage"])
  })

  it("defaults to the 20 000-row export cap", async () => {
    expect(TELEMETRY_EXPORT_CAP).toBe(20_000)
  })
})

describe("buildTelemetryCsv", () => {
  const result: Pick<TelemetryExport, "points" | "units" | "metrics"> = {
    points: [
      { ts: Date.parse("2026-08-04T12:00:01.000Z"), values: { "imu.accel_x": 1.5 } },
      {
        ts: Date.parse("2026-08-04T12:00:00.000Z"),
        values: { "imu.accel_x": 2, "system.cpu_usage": 40 },
      },
    ],
    units: { "imu.accel_x": "m/s^2", "system.cpu_usage": "%" },
    metrics: ["imu.accel_x", "system.cpu_usage"],
  }

  it("uses the on-screen column order and labelled headers", () => {
    const csv = buildTelemetryCsv(result, ["imu.accel_x", "system.cpu_usage"])
    // Superscript, because the table header renders the same way.
    expect(csv.split("\n")[0]).toBe("Time,Accel X (m/s²),CPU Usage (%)")
  })

  it("writes one row per sample, blank where a metric had no value", () => {
    const csv = buildTelemetryCsv(result, ["imu.accel_x", "system.cpu_usage"])
    const lines = csv.split("\n")
    expect(lines).toHaveLength(3) // header + 2 samples
    expect(lines[1]).toBe("2026-08-04T12:00:01.000Z,1.5,")
    expect(lines[2]).toBe("2026-08-04T12:00:00.000Z,2,40")
  })

  it("emits a column the caller asked for even when no sample carried it", () => {
    const csv = buildTelemetryCsv(result, ["imu.accel_x", "gps.lat"])
    expect(csv.split("\n")[0]).toBe("Time,Accel X (m/s²),Latitude")
    expect(csv.split("\n")[1]).toBe("2026-08-04T12:00:01.000Z,1.5,")
  })

  it("falls back to the discovered metrics when there are no capability columns", () => {
    const csv = buildTelemetryCsv(result, [])
    expect(csv.split("\n")[0]).toBe("Time,Accel X (m/s²),CPU Usage (%)")
  })

  it("quotes cells containing a comma, quote or newline", () => {
    const csv = buildTelemetryCsv(
      { points: [], units: { "x.y": 'a,b"c' }, metrics: ["x.y"] },
      ["x.y"],
    )
    expect(csv).toBe('Time,"x.y (a,b""c)"')
  })
})
