import { describe, expect, it } from "vitest"
import {
  axisDomain,
  CHART_METRIC_NAMES,
  seriesSlot,
  SERIES_SLOTS,
  TELEMETRY_GRAPH_GROUPS,
  type ChartMetricGroup,
} from "./telemetry-metrics"

/**
 * `axisDomain` is what stops a trends panel from being unreadable, and every
 * rule in it came from a real chart that looked wrong. These cases pin those
 * shapes: an open end is padded and snapped to a round step, a fixed end stays
 * exactly where the catalog put it, and the span is always four steps so the
 * five ticks are whole numbers.
 */
describe("axisDomain", () => {
  /** The ticks the axis will actually print, given a computed domain. */
  const ticks = ([lo, hi]: [number | "auto", number | "auto"]) => {
    const step = ((hi as number) - (lo as number)) / 4
    return [0, 1, 2, 3, 4].map((i) => (lo as number) + i * step)
  }

  it("keeps a pinned floor and rounds the open ceiling out past the data", () => {
    // CPU sitting at 7-15%: the floor must stay at zero (that is what makes
    // "15% of capacity" legible) and the ceiling must clear the peak.
    const [lo, hi] = axisDomain([0, "auto"], { min: 7, max: 15 })
    expect(lo).toBe(0)
    expect(hi as number).toBeGreaterThan(15)
    expect(ticks([lo, hi]).every((t) => Number.isInteger(t))).toBe(true)
  })

  it("leaves a fully fixed domain alone", () => {
    // Course is a compass bearing: auto-scaling it would disguise a wrap as
    // movement, so neither end may move whatever the data did.
    expect(axisDomain([0, 360], { min: 12, max: 41 })).toEqual([0, 360])
    expect(axisDomain([-180, 180], { min: -3, max: 2 })).toEqual([-180, 180])
  })

  it("pads both ends of an open domain without touching the trace", () => {
    // The 5 V rail: a 0.39 V sag has to occupy the plot, not hug the frame.
    const [lo, hi] = axisDomain(["auto", "auto"], { min: 4.71, max: 5.1 })
    expect(lo as number).toBeLessThan(4.71)
    expect(hi as number).toBeGreaterThan(5.1)
  })

  it("gives a dead-flat series an axis with height", () => {
    // PSU max current is negotiated once at boot: min === max, so there is no
    // span to take a percentage of, and a zero-height domain would be a
    // degenerate axis.
    const [lo, hi] = axisDomain([0, "auto"], { min: 3000, max: 3000 })
    expect(lo).toBe(0)
    expect(hi as number).toBeGreaterThan(3000)
  })

  it("returns the catalog's own domain when there is no data to measure", () => {
    expect(axisDomain([0, "auto"], null)).toEqual([0, "auto"])
  })
})

describe("seriesSlot", () => {
  it("colours a single-line panel by its place in its own tab", () => {
    // Turning one GPS panel off must not repaint the ones beside it, so the
    // slot comes from the catalog order rather than from what is visible.
    const gps = TELEMETRY_GRAPH_GROUPS.filter((g) => g.section === "GPS")
    gps.forEach((group, i) => {
      expect(seriesSlot(group, group.metrics[0]), group.id).toBe(i)
    })
  })

  it("colours a multi-line panel from the first slots, in the panel's order", () => {
    // The palette only holds slots 1-3 to the stricter all-pairs colour-blind
    // gate, so a multi-line panel has to start at slot 0 and stay inside them.
    const multi = TELEMETRY_GRAPH_GROUPS.filter((g) => g.metrics.length > 1)
    expect(multi.length).toBeGreaterThan(0)
    for (const group of multi) {
      expect(group.metrics.length).toBeLessThanOrEqual(3)
      expect(group.metrics.map((m) => seriesSlot(group, m))).toEqual(
        group.metrics.map((_, i) => i)
      )
    }
  })

  it("never asks for a slot the palette does not define", () => {
    for (const group of TELEMETRY_GRAPH_GROUPS)
      for (const metric of group.metrics)
        expect(seriesSlot(group, metric), metric.metric).toBeLessThan(
          SERIES_SLOTS
        )
  })
})

describe("the catalog", () => {
  it("names every metric once", () => {
    expect(new Set(CHART_METRIC_NAMES).size).toBe(CHART_METRIC_NAMES.length)
  })

  it("gives every panel a stable id", () => {
    const ids = TELEMETRY_GRAPH_GROUPS.map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("keeps a panel to one unit, which is the whole reason it is a panel", () => {
    // Nothing here can check units across groups, but a group carrying several
    // metrics is the case where a second unit would sneak in, so it is spelled
    // out: the axis is shared, so the unit has to be too.
    const multi: ChartMetricGroup[] = TELEMETRY_GRAPH_GROUPS.filter(
      (g) => g.metrics.length > 1
    )
    for (const group of multi) expect(group.unit).toBeTruthy()
  })
})
