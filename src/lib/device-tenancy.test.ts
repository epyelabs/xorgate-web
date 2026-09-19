import { describe, expect, it } from "vitest"
import type { Device } from "@xorgate/sdk"
import { deviceAdoption, reportedTelemetryScope } from "./device-tenancy"

const ORG = "org-1"
const WS = "ws-new"

function device(
  effective: Record<string, unknown> | null,
  overrides: Partial<Device> = {}
): Device {
  return {
    id: "dev-1",
    workspaceId: WS,
    configRev: 23,
    reportedConfig:
      effective === null
        ? null
        : {
            v: 1,
            deviceId: "dev-1",
            ts: "2026-09-19T00:00:00.000Z",
            // Deliberately EQUAL to configRev throughout: a scope change does
            // not move the rev, so no test here may lean on it.
            rev: 23,
            origin: "cloud",
            effective,
            status: {},
          },
    ...overrides,
  } as Device
}

describe("reportedTelemetryScope", () => {
  it("is null when the device has never reported", () => {
    expect(reportedTelemetryScope(device(null))).toBeNull()
  })

  it("is null when the report carries no telemetryScope (agent older than v0.0.6)", () => {
    expect(reportedTelemetryScope(device({ recording: {} }))).toBeNull()
  })

  it("is null when telemetryScope is not an object", () => {
    expect(reportedTelemetryScope(device({ telemetryScope: "scoped" }))).toBeNull()
  })

  it("reads the block the agent reports", () => {
    expect(
      reportedTelemetryScope(
        device({
          telemetryScope: { scoped: true, organizationId: ORG, workspaceId: WS },
        })
      )
    ).toEqual({ scoped: true, organizationId: ORG, workspaceId: WS })
  })
})

describe("deviceAdoption", () => {
  it("confirms when the device says it publishes under the row's tenancy", () => {
    const d = device({
      telemetryScope: { scoped: true, organizationId: ORG, workspaceId: WS },
    })
    expect(deviceAdoption(d, ORG)).toBe("confirmed")
  })

  it("is pending when the device still names the OLD workspace", () => {
    const d = device({
      telemetryScope: {
        scoped: true,
        organizationId: ORG,
        workspaceId: "ws-old",
      },
    })
    expect(deviceAdoption(d, ORG)).toBe("pending")
  })

  it("is pending when the device still names the old ORGANIZATION", () => {
    const d = device({
      telemetryScope: { scoped: true, organizationId: "org-old", workspaceId: WS },
    })
    expect(deviceAdoption(d, ORG)).toBe("pending")
  })

  // The distinction the badge exists to keep: "never told us" is not "told us,
  // and is behind". Collapsing it would mark every pre-v0.0.6 agent as lagging
  // forever.
  it("is unknown — not pending — when the agent never reports a scope", () => {
    expect(deviceAdoption(device({}), ORG)).toBe("unknown")
    expect(deviceAdoption(device(null), ORG)).toBe("unknown")
  })

  it("is unknown before the active organization is known", () => {
    const d = device({
      telemetryScope: { scoped: true, organizationId: ORG, workspaceId: WS },
    })
    expect(deviceAdoption(d, null)).toBe("unknown")
  })

  // A device on the legacy unscoped plane reports scoped:false with no ids.
  it("is pending for a device that fell back to the legacy plane", () => {
    expect(deviceAdoption(device({ telemetryScope: { scoped: false } }), ORG)).toBe(
      "pending"
    )
  })
})
