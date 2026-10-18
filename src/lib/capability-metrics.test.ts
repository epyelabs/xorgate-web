import { describe, expect, it } from "vitest"
import type { IoCapabilities } from "@xorgate/sdk"
import {
  missingCapabilities,
  obdMetrics,
  producibleMetricKeys,
  systemMetrics,
  systemReadoutMetrics,
  telemetryMetricOptions,
} from "./capability-metrics"

/**
 * `peripherals.obd` (obd2-bluetooth-integration P2): the model declares its
 * OBD fields in display order and every picker in the app must see them as
 * `obd.<field>`, after the box's own telemetry, exactly as the backend's
 * producibleMetricKeys and the SDK's declaredMetrics do.
 */
const v2Obd: IoCapabilities = {
  schemaVersion: 2,
  system: { platform: "rpi-cm5", fields: ["cpu_usage"] },
  comm: { gps: { fields: ["lat", "lon", "speed"] } },
  peripherals: {
    obd: {
      adapter: "elm327",
      transport: "bt-spp",
      rateHz: 1,
      fields: ["link", "rpm", "speed", "mil"],
    },
  },
}

const v2Plain: IoCapabilities = {
  schemaVersion: 2,
  system: { platform: "rpi-cm5", fields: ["cpu_usage"] },
}

const v1: IoCapabilities = {
  schemaVersion: 1,
  system: { fields: ["cpu_usage"] },
}

describe("obdMetrics", () => {
  it("prefixes the declared fields and keeps their declared order", () => {
    expect(obdMetrics(v2Obd)).toEqual([
      "obd.link",
      "obd.rpm",
      "obd.speed",
      "obd.mil",
    ])
  })

  it("declares nothing for a v2 model without the section, a v1 model, or no model", () => {
    expect(obdMetrics(v2Plain)).toEqual([])
    expect(obdMetrics(v1)).toEqual([])
    expect(obdMetrics(null)).toEqual([])
  })
})

describe("the pickers", () => {
  it("offer obd.* after the device's own groups, in declared order", () => {
    const options = telemetryMetricOptions(v2Obd)
    expect(options.slice(-4)).toEqual([
      "obd.link",
      "obd.rpm",
      "obd.speed",
      "obd.mil",
    ])
    // GPS and OBD stay separate sensors (plan decision 4): both speeds exist.
    expect(options).toContain("gps.speed")
    expect(options).toContain("obd.speed")
  })

  it("let a workflow require an obd metric from a model that declares it", () => {
    expect(producibleMetricKeys(v2Obd).has("obd.rpm")).toBe(true)
    expect(missingCapabilities(["metric:obd.rpm"], v2Obd)).toEqual([])
    expect(missingCapabilities(["metric:obd.rpm"], v2Plain)).toEqual([
      "metric:obd.rpm",
    ])
  })
})

describe("systemReadoutMetrics", () => {
  const withLed: IoCapabilities = {
    schemaVersion: 2,
    system: {
      platform: "rpi-cm5",
      fields: ["cpu_usage", "throttled", "led_state", "health_flags"],
    },
  }

  it("drops the status LED pair from the tiles but keeps it producible", () => {
    expect(systemReadoutMetrics(withLed)).toEqual([
      "system.cpu_usage",
      "system.throttled",
    ])
    expect(systemMetrics(withLed)).toContain("system.led_state")
    expect(producibleMetricKeys(withLed).has("system.health_flags")).toBe(true)
    expect(systemReadoutMetrics(null)).toEqual([])
  })
})
