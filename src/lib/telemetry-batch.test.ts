import { describe, expect, it } from "vitest"
import {
  chunkMetrics,
  mergeHistoryPages,
  TELEMETRY_METRIC_LIMIT,
} from "./telemetry-batch"
import { TELEMETRY_GRAPH_GROUPS } from "./telemetry-metrics"

/**
 * The API takes twenty metrics a call and the OBD-II tab asks for more than
 * that on "Show all". The split has to keep every metric, in order, and the
 * merge has to hand back one page the pivot cannot tell from a single answer.
 */
describe("chunkMetrics", () => {
  it("is needed: the whole OBD-II tab is past one call's cap", () => {
    const all = TELEMETRY_GRAPH_GROUPS.filter((g) => g.section === "OBD-II")
      .flatMap((g) => g.metrics.map((m) => m.metric))
    expect(new Set(all).size).toBeGreaterThan(TELEMETRY_METRIC_LIMIT)
  })

  it("splits into consecutive runs of at most the limit, keeping order", () => {
    const names = Array.from({ length: 21 }, (_, i) => `m${i}`)
    const chunks = chunkMetrics(names)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toHaveLength(TELEMETRY_METRIC_LIMIT)
    expect(chunks[1]).toEqual(["m20"])
    expect(chunks.flat()).toEqual(names)
  })

  it("keeps a list at or under the limit to one call", () => {
    expect(chunkMetrics(["a"])).toEqual([["a"]])
    expect(chunkMetrics(Array.from({ length: 20 }, (_, i) => `m${i}`))).toHaveLength(1)
  })

  it("asks nothing for nothing", () => {
    expect(chunkMetrics([])).toEqual([])
  })

  it("honours a custom limit and rejects a useless one", () => {
    expect(chunkMetrics(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]])
    expect(() => chunkMetrics(["a"], 0)).toThrow(RangeError)
  })
})

describe("mergeHistoryPages", () => {
  it("concatenates readings in page order and OR-s truncation", () => {
    const merged = mergeHistoryPages([
      { readings: [{ metric: "a" }], bucketSeconds: 7, truncated: false },
      { readings: [{ metric: "b" }, { metric: "c" }], bucketSeconds: 7, truncated: true },
      { readings: null },
    ])
    expect(merged.readings.map((r) => r.metric)).toEqual(["a", "b", "c"])
    expect(merged.bucketSeconds).toBe(7)
    expect(merged.truncated).toBe(true)
  })

  it("hands back an honest empty page for no pages", () => {
    expect(mergeHistoryPages([])).toEqual({
      readings: [],
      bucketSeconds: null,
      truncated: false,
    })
  })
})
