import { describe, expect, it } from "vitest"
import { XorgateError } from "@xorgate/sdk"
import contract from "@/lib/config-contract.json"
import {
  buildSimulationConfig,
  formatScenarioStats,
  SIMULATION_DEFAULTS,
  simulationCreateErrorMessage,
  simulationScenarioTitle,
  storedSimulationConfig,
} from "@/lib/device-simulation"
import { computeConfigStatus, NAMESPACE_TABS } from "@/lib/device-config-status"
import type { Device } from "@xorgate/sdk"

describe("buildSimulationConfig", () => {
  it("keeps the stored loop and gap and swaps only the scenario", () => {
    const config = { simulation: { scenarioId: "highway-2026-09-20", loop: false, gapSeconds: 120 } }
    expect(buildSimulationConfig(config, "parked-2026-09-17")).toEqual({
      scenarioId: "parked-2026-09-17",
      loop: false,
      gapSeconds: 120,
    })
  })

  it("always sends the WHOLE namespace, falling back to the contract defaults", () => {
    // `{simulation:{scenarioId}}` alone is a 400 (all three fields required).
    const built = buildSimulationConfig({}, "urban-2026-09-18")
    expect(Object.keys(built).sort()).toEqual(["gapSeconds", "loop", "scenarioId"])
    expect(built).toEqual({ ...contract.namespaces.simulation.defaults, scenarioId: "urban-2026-09-18" })
  })

  it("fills a partially stored namespace from the defaults", () => {
    expect(buildSimulationConfig({ simulation: { scenarioId: "x", loop: false } }, "y")).toEqual({
      scenarioId: "y",
      loop: false,
      gapSeconds: SIMULATION_DEFAULTS.gapSeconds,
    })
  })
})

describe("storedSimulationConfig", () => {
  it("is null for a device holding no namespace (every real device)", () => {
    expect(storedSimulationConfig(null)).toBeNull()
    expect(storedSimulationConfig({ recording: {} })).toBeNull()
    expect(storedSimulationConfig({ simulation: null })).toBeNull()
  })
})

describe("simulationScenarioTitle", () => {
  const scenarios = [
    { id: "urban-2026-09-18", title: "Short stop-and-go urban" },
    { id: "city-2026-09-27", title: "City drive with stops" },
  ]

  it("names the stored scenario", () => {
    const config = { simulation: { scenarioId: "urban-2026-09-18", loop: true, gapSeconds: 30 } }
    expect(simulationScenarioTitle(config, scenarios)).toBe("Short stop-and-go urban")
  })

  it("is null while the catalog loads, for a real device, and for an unknown id", () => {
    const config = { simulation: { scenarioId: "urban-2026-09-18", loop: true, gapSeconds: 30 } }
    expect(simulationScenarioTitle(config, undefined)).toBeNull()
    expect(simulationScenarioTitle({ recording: {} }, scenarios)).toBeNull()
    expect(simulationScenarioTitle({ simulation: { scenarioId: "parked-2026-09-17" } }, scenarios)).toBeNull()
  })
})

describe("formatScenarioStats", () => {
  it("renders minutes, km and max km/h", () => {
    expect(formatScenarioStats({ durationMs: 942_000, distanceM: 7_912, maxKph: 108.9 })).toBe(
      "16 min · 7.9 km · max 109 km/h"
    )
    expect(formatScenarioStats({ durationMs: 2_730_000, distanceM: 56_900, maxKph: 141.7 })).toBe(
      "46 min · 57 km · max 142 km/h"
    )
  })

  it("skips what the catalog left null", () => {
    expect(formatScenarioStats({ durationMs: 570_000, distanceM: null, maxKph: null })).toBe("10 min")
  })
})

describe("simulationCreateErrorMessage", () => {
  const quota = (details: Record<string, unknown>) =>
    new XorgateError({
      code: "SIMULATION_QUOTA_EXCEEDED",
      status: 409,
      message: "quota",
      details,
    })

  it("names the organization quota and its limit", () => {
    expect(
      simulationCreateErrorMessage(quota({ scope: "organization", limit: 2, count: 2 }), "x")
    ).toBe("This organization already has 2 simulated devices, the limit. Delete one to make room.")
  })

  it("names the global quota and its limit", () => {
    expect(simulationCreateErrorMessage(quota({ scope: "global", limit: 8, count: 8 }), "x")).toMatch(
      /8 simulations across all organizations/
    )
  })

  it("says nothing was created on a provision failure", () => {
    const err = new XorgateError({ code: "SIMULATION_PROVISION_FAILED", status: 502, message: "boom" })
    expect(simulationCreateErrorMessage(err, "x")).toMatch(/Nothing was created/)
  })

  it("falls back for anything else", () => {
    expect(simulationCreateErrorMessage(new Error("net"), "fallback")).toBe("fallback")
  })
})

describe("the simulation namespace in the config-status verdicts", () => {
  const base = {
    id: "d",
    status: "online",
    configRev: 3,
    config: {},
    reportedConfig: { rev: 3, effective: { agent: { mode: "real" } }, status: {} },
  } as unknown as Device

  it("reads `unset` (no attention badge) on a real device", () => {
    expect(computeConfigStatus(base).simulation.state).toBe("unset")
  })

  it("stays `unset` on a real device while another save is pending", () => {
    const behind = { ...base, configRev: 4 } as Device
    expect(computeConfigStatus(behind).recording.state).toBe("pending")
    expect(computeConfigStatus(behind).simulation.state).toBe("unset")
  })

  it("reads the device's own verdict on a sim", () => {
    const sim = {
      ...base,
      simulated: true,
      config: { simulation: { scenarioId: "parked-2026-09-17", loop: true, gapSeconds: 30 } },
      reportedConfig: {
        rev: 3,
        effective: { simulation: { scenarioId: "parked-2026-09-17", loop: true, gapSeconds: 30 } },
        status: { simulation: { state: "applied" } },
      },
    } as unknown as Device
    expect(computeConfigStatus(sim).simulation.state).toBe("applied")
  })

  it("is surfaced on the General tab", () => {
    expect(NAMESPACE_TABS.simulation).toEqual(["general"])
  })
})
