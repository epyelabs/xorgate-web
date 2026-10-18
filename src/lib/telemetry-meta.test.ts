import { describe, expect, it } from "vitest"
import contract from "@/lib/config-contract.json"
import { TELEMETRY_GRAPH_GROUPS } from "./telemetry-metrics"
import {
  formatHealthFlags,
  formatMetricValue,
  METRIC_LABELS,
  metricLabel,
  orderMetrics,
} from "./telemetry-meta"

/**
 * The closed `obd.<field>` vocabulary (the contract's `obd.fields` enum), in
 * the agent's order. The torque trio is appended after `link` (PIDs 62/63 and
 * the derived Nm), so it is listed here as the contract spells it.
 */
const OBD_FIELDS = [
  "rpm",
  "speed",
  "coolant_temp",
  "engine_load",
  "throttle",
  "pedal",
  "intake_temp",
  "ambient_temp",
  "intake_map",
  "baro",
  "fuel_level",
  "fuel_rate",
  "module_voltage",
  "adapter_voltage",
  "run_time",
  "odometer",
  "gear",
  "distance_since_clear",
  "mil",
  "dtc_count",
  "link",
  "engine_torque_pct",
  "reference_torque",
  "engine_torque",
]

describe("OBD-II (obd) metrics", () => {
  it("matches the contract's closed field vocabulary", () => {
    expect(OBD_FIELDS).toEqual(
      contract.namespaces.obd.jsonSchema.properties.fields.items.enum
    )
  })

  it("labels all 24 fields, so no table header ever falls back to the raw key", () => {
    for (const f of OBD_FIELDS) {
      expect(METRIC_LABELS[`obd.${f}`], f).toBeTruthy()
      expect(metricLabel(`obd.${f}`)).not.toBe(`obd.${f}`)
    }
  })

  it("renders the coded states as words, not numbers", () => {
    // obd.link is the health code: 2 is the only state with live readings.
    expect(formatMetricValue(0, "obd.link")).toBe("No adapter")
    expect(formatMetricValue(1, "obd.link")).toBe("Adapter only")
    expect(formatMetricValue(2, "obd.link")).toBe("ECU answering")
    expect(formatMetricValue(7, "obd.link")).toBe("7")
    // The check-engine lamp.
    expect(formatMetricValue(0, "obd.mil")).toBe("Off")
    expect(formatMetricValue(1, "obd.mil")).toBe("On")
    // Gear 0 is park/neutral.
    expect(formatMetricValue(0, "obd.gear")).toBe("P/N")
    expect(formatMetricValue(3, "obd.gear")).toBe("3")
  })

  it("keeps counters and the engine speed whole", () => {
    expect(formatMetricValue(2, "obd.dtc_count")).toBe("2")
    expect(formatMetricValue(812.25, "obd.rpm")).toBe("812")
    expect(formatMetricValue(61.5, "obd.run_time")).toBe("62")
    // Quantities keep the default rounding (one decimal from 10 up).
    expect(formatMetricValue(88.46, "obd.coolant_temp")).toBe("88.5")
    expect(formatMetricValue(13.84, "obd.module_voltage")).toBe("13.8")
    expect(formatMetricValue(null, "obd.rpm")).toBe("—")
  })

  it("labels the torque trio and places it right after engine load", () => {
    expect(metricLabel("obd.engine_torque")).toBe("Engine Torque")
    expect(metricLabel("obd.engine_torque_pct")).toBe("Actual Torque")
    expect(metricLabel("obd.reference_torque")).toBe("Reference Torque")
    const keys = Object.keys(METRIC_LABELS)
    const at = keys.indexOf("obd.engine_load")
    expect(keys.slice(at, at + 5)).toEqual([
      "obd.engine_load",
      "obd.engine_torque",
      "obd.engine_torque_pct",
      "obd.reference_torque",
      "obd.throttle",
    ])
  })

  it("formats torque: whole percent and reference, one-decimal Nm, signed", () => {
    expect(formatMetricValue(42.6, "obd.engine_torque_pct")).toBe("43")
    expect(formatMetricValue(-18.4, "obd.engine_torque_pct")).toBe("-18")
    expect(formatMetricValue(-125, "obd.engine_torque_pct")).toBe("-125")
    expect(formatMetricValue(-0.3, "obd.engine_torque_pct")).toBe("0")
    expect(formatMetricValue(280, "obd.reference_torque")).toBe("280")
    expect(formatMetricValue(279.6, "obd.reference_torque")).toBe("280")
    expect(formatMetricValue(119.6, "obd.engine_torque")).toBe("119.6")
    expect(formatMetricValue(5.25, "obd.engine_torque")).toBe("5.3")
    expect(formatMetricValue(-50.4, "obd.engine_torque")).toBe("-50.4")
    expect(formatMetricValue(-350, "obd.engine_torque")).toBe("-350.0")
    expect(formatMetricValue(-0.02, "obd.engine_torque")).toBe("0.0")
    expect(formatMetricValue(null, "obd.engine_torque")).toBe("—")
  })

  it("orders the OBD group after the device's own telemetry", () => {
    const ordered = orderMetrics([
      "obd.rpm",
      "system.cpu_usage",
      "obd.link",
      "gps.speed",
      "imu.accel_x",
    ])
    expect(ordered).toEqual([
      "imu.accel_x",
      "gps.speed",
      "system.cpu_usage",
      "obd.rpm",
      "obd.link",
    ])
  })
})

describe("status LED (system.led_state / system.health_flags)", () => {
  it("labels both fields", () => {
    expect(metricLabel("system.led_state")).toBe("Device status")
    expect(metricLabel("system.health_flags")).toBe("Health flags")
  })

  it("renders the code as its LED-ladder name", () => {
    expect(formatMetricValue(0, "system.led_state")).toBe("Healthy")
    expect(formatMetricValue(2, "system.led_state")).toBe(
      "GPS: waiting for fix"
    )
    expect(formatMetricValue(3, "system.led_state")).toBe("Network recovering")
    expect(formatMetricValue(5, "system.led_state")).toBe("Undervoltage")
    expect(formatMetricValue(9, "system.led_state")).toBe("Unknown (9)")
    expect(formatMetricValue(null, "system.led_state")).toBe("—")
  })

  it("renders the flags as the comma-joined names of the set bits", () => {
    expect(formatMetricValue(0, "system.health_flags")).toBe("None")
    expect(formatMetricValue(1, "system.health_flags")).toBe("Undervoltage")
    // lte_down (4) + mqtt_down (8) + gps_no_fix (16)
    expect(formatMetricValue(28, "system.health_flags")).toBe(
      "LTE down, Cloud link down, GPS: no fix"
    )
    expect(formatHealthFlags(129)).toBe("Undervoltage, Power shed")
    // An averaged bucket is not a mask: shown raw, never mis-decoded.
    expect(formatMetricValue(2.5, "system.health_flags")).toBe("2.5")
  })

  it("orders both after the box's other system fields", () => {
    const keys = Object.keys(METRIC_LABELS)
    const at = keys.indexOf("system.psu_max_current")
    expect(keys.slice(at + 1, at + 3)).toEqual([
      "system.led_state",
      "system.health_flags",
    ])
  })

  it("keeps both out of the trends chart catalog (enum and bitmask)", () => {
    const charted = TELEMETRY_GRAPH_GROUPS.flatMap((g) =>
      g.metrics.map((m) => m.metric)
    )
    expect(charted).not.toContain("system.led_state")
    expect(charted).not.toContain("system.health_flags")
  })
})
