import { describe, expect, it } from "vitest"
import {
  axisDomain,
  CHART_METRIC_NAMES,
  OBD_CHART_FIELDS,
  seriesSlot,
  SERIES_SLOTS,
  TELEMETRY_GRAPH_GROUPS,
  type ChartMetricGroup,
} from "./telemetry-metrics"
import { metricLabel } from "./telemetry-meta"

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

  it("prints clean bounds, not binary residue", () => {
    // Ambient temp 16-17 °C snapped to a 0.4 step: 39 * 0.4 is
    // 15.600000000000001 in a double, and that tail reached the tick labels.
    const [lo, hi] = axisDomain(["auto", "auto"], { min: 16, max: 17 })
    expect(String(lo)).toBe("15.6")
    expect(String(hi)).toBe("17.2")
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

/**
 * The OBD-II tab, by the owner's rule: every OBD metric the readout grid can
 * show is a chart of its own, in the grid's order and under the grid's label,
 * with the one exception of the speed panel, which carries GPS speed as a
 * comparison.
 */
describe("the OBD-II section", () => {
  const obd = TELEMETRY_GRAPH_GROUPS.filter((g) => g.section === "OBD-II")

  it("lists all twenty-three OBD metrics, one panel each, in readout order", () => {
    expect(obd.map((g) => g.metrics[0].metric)).toEqual([
      "obd.rpm",
      "obd.speed",
      "obd.coolant_temp",
      "obd.engine_load",
      "obd.engine_torque",
      "obd.engine_torque_pct",
      "obd.reference_torque",
      "obd.throttle",
      "obd.pedal",
      "obd.intake_temp",
      "obd.ambient_temp",
      "obd.intake_map",
      "obd.baro",
      "obd.fuel_level",
      "obd.fuel_rate",
      "obd.module_voltage",
      "obd.adapter_voltage",
      "obd.run_time",
      "obd.odometer",
      "obd.gear",
      "obd.distance_since_clear",
      "obd.mil",
      "obd.dtc_count",
    ])
    expect(OBD_CHART_FIELDS).toHaveLength(23)
    expect(CHART_METRIC_NAMES).not.toContain("obd.link")
  })

  it("one metric per panel, except the speed pair", () => {
    for (const group of obd) {
      if (group.id === "obd-speed") {
        expect(group.metrics.map((m) => m.metric)).toEqual([
          "obd.speed",
          "gps.speed",
        ])
      } else {
        expect(group.metrics, group.id).toHaveLength(1)
      }
    }
    // Throttle and pedal are two charts now, not one.
    expect(obd.filter((g) => g.metrics.length > 1)).toHaveLength(1)
  })

  it("uses the readout grid's labels", () => {
    for (const group of obd) {
      const metric = group.metrics[0].metric
      expect(group.metrics[0].label, metric).toBe(metricLabel(metric))
      if (group.id !== "obd-speed") expect(group.title, metric).toBe(metricLabel(metric))
    }
  })

  it("scales percentages 0-100, voltages 10-16, gear 0-10 and the lamp 0/1", () => {
    const by = (metric: string) => obd.find((g) => g.metrics[0].metric === metric)!
    for (const pct of ["obd.engine_load", "obd.throttle", "obd.pedal", "obd.fuel_level"])
      expect(by(pct).domain, pct).toEqual([0, 100])
    for (const v of ["obd.module_voltage", "obd.adapter_voltage"])
      expect(by(v).domain, v).toEqual([10, 16])
    expect(by("obd.gear").domain).toEqual([0, 10])
    expect(by("obd.mil").domain).toEqual([0, 1])
    expect(by("obd.mil").ticks).toEqual([0, 1])
    expect(by("obd.mil").curve).toBe("step")
    expect(by("obd.dtc_count").domain).toEqual([0, 5])
  })

  it("lets signed torque go below zero and keeps the reference on a zero floor", () => {
    const by = (metric: string) => obd.find((g) => g.metrics[0].metric === metric)!
    expect(by("obd.engine_torque")).toMatchObject({
      id: "engine-torque",
      title: "Engine Torque",
      unit: "Nm",
      domain: ["auto", "auto"],
    })
    expect(by("obd.engine_torque").metrics[0].precision).toBe(1)
    expect(by("obd.engine_torque_pct")).toMatchObject({
      id: "engine-torque-pct",
      title: "Actual Torque",
      unit: "%",
      domain: ["auto", "auto"],
    })
    expect(by("obd.engine_torque_pct").metrics[0].precision).toBe(0)
    expect(by("obd.reference_torque")).toMatchObject({
      id: "reference-torque",
      title: "Reference Torque",
      unit: "Nm",
      domain: [0, "auto"],
    })
    expect(by("obd.reference_torque").metrics[0].precision).toBe(0)
    for (const m of ["obd.engine_torque", "obd.engine_torque_pct", "obd.reference_torque"])
      expect(by(m).metrics, m).toHaveLength(1)
  })

  it("opens with RPM, speed, coolant and fuel level on", () => {
    const on = obd
      .flatMap((g) => g.metrics)
      .filter((m) => m.defaultOn)
      .map((m) => m.metric)
    expect(on).toEqual(["obd.rpm", "obd.speed", "obd.coolant_temp", "obd.fuel_level"])
  })
})
