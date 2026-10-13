import { describe, expect, it } from "vitest"
import {
  formatMetricValue,
  METRIC_LABELS,
  metricLabel,
  orderMetrics,
} from "./telemetry-meta"

/** The closed `obd.<field>` vocabulary (SDK ObdField), in the agent's order. */
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
]

describe("vehicle (obd) metrics", () => {
  it("labels all 21 fields, so no table header ever falls back to the raw key", () => {
    for (const f of OBD_FIELDS) {
      expect(METRIC_LABELS[`obd.${f}`], f).toBeTruthy()
      expect(metricLabel(`obd.${f}`)).not.toBe(`obd.${f}`)
    }
  })

  it("renders the coded states as words, not numbers", () => {
    // obd.link is the health code: 2 is the only state with live readings.
    expect(formatMetricValue(0, "obd.link")).toBe("No adapter")
    expect(formatMetricValue(1, "obd.link")).toBe("Adapter only")
    expect(formatMetricValue(2, "obd.link")).toBe("Vehicle")
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

  it("orders the vehicle group after the device's own telemetry", () => {
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
