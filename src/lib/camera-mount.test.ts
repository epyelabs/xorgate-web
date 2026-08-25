import { describe, expect, it } from "vitest"
import type { Device } from "@xorgate/sdk"
import { resolveCameraMount } from "./device-config-defaults"
import {
  computeConfigStatus,
  configStateExplanation,
  NAMESPACE_TABS,
} from "./device-config-status"

/**
 * The `cameraMount` namespace in the settings UI (cam-sensor-level-rotate,
 * Phase 3).
 *
 * The rotation reaches the sensor only at the device's next boot, so what this
 * page must never do is show a settled green tick over a camera that is still
 * the wrong way up. The device says so itself — `adjusted` plus a detail
 * naming the camera and both rotations — and these tests pin that the page
 * carries that sentence through rather than substituting a cheerier one.
 */

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: "dev-1",
    status: "online",
    config: {},
    configRev: 0,
    reportedConfig: null,
    reportedAt: null,
    ...overrides,
  } as Device
}

const REPORT_PENDING = {
  v: 1,
  ts: 1,
  rev: 4,
  origin: "cloud",
  effective: {
    cameraMount: {
      cameras: { cam0: { rotationDeg: 0 } },
      pending: { cam0: { rotationDeg: 180 } },
      rebootRequired: true,
    },
  },
  status: {
    cameraMount: {
      state: "adjusted",
      at: 2,
      detail: "written to the boot config — REBOOT REQUIRED to apply: cam0 180° (running 0°)",
    },
  },
}

describe("resolveCameraMount", () => {
  it("reads the per-camera rotations out of the stored namespace", () => {
    expect(
      resolveCameraMount({
        cameras: { cam0: { rotationDeg: 180 }, cam1: { rotationDeg: 0 } },
      })
    ).toEqual({ cam0: 180, cam1: 0 })
  })

  it("returns nothing for an unconfigured device", () => {
    expect(resolveCameraMount(undefined)).toEqual({})
    expect(resolveCameraMount(null)).toEqual({})
    expect(resolveCameraMount({})).toEqual({})
    expect(resolveCameraMount({ cameras: {} })).toEqual({})
  })

  it("drops a rotation this app cannot render, rather than showing a wrong switch", () => {
    // Defensive on purpose: `config` is stored JSON, and a value outside the
    // closed 0/180 set could only come from something that bypassed the API.
    expect(
      resolveCameraMount({
        cameras: { cam0: { rotationDeg: 90 }, cam1: { rotationDeg: "180" }, cam2: null },
      })
    ).toEqual({})
  })
})

describe("the cameraMount card's status", () => {
  it("shows the device's own reboot-required sentence, in amber not green", () => {
    const status = computeConfigStatus(
      device({
        configRev: 4,
        config: { cameraMount: { cameras: { cam0: { rotationDeg: 180 } } } } as Device["config"],
        reportedConfig: REPORT_PENDING as unknown as Device["reportedConfig"],
      })
    )
    expect(status.cameraMount.state).toBe("adjusted")
    expect(configStateExplanation(status.cameraMount)).toContain("REBOOT REQUIRED")
    expect(configStateExplanation(status.cameraMount)).toContain("cam0 180°")
  })

  it("settles to applied once the device has booted with it", () => {
    const status = computeConfigStatus(
      device({
        configRev: 4,
        config: { cameraMount: { cameras: { cam0: { rotationDeg: 180 } } } } as Device["config"],
        reportedConfig: {
          ...REPORT_PENDING,
          effective: {
            cameraMount: { cameras: { cam0: { rotationDeg: 180 } }, rebootRequired: false },
          },
          status: { cameraMount: { state: "applied", at: 3 } },
        } as unknown as Device["reportedConfig"],
      })
    )
    expect(status.cameraMount.state).toBe("applied")
    expect(configStateExplanation(status.cameraMount)).toBeNull()
  })

  it("stays pending while the device has not caught up with the save", () => {
    const status = computeConfigStatus(
      device({
        configRev: 9, // saved after the report was written
        status: "online",
        config: { cameraMount: { cameras: { cam0: { rotationDeg: 180 } } } } as Device["config"],
        reportedConfig: REPORT_PENDING as unknown as Device["reportedConfig"],
      })
    )
    expect(status.cameraMount.state).toBe("pending")
  })

  it("surfaces a device that cannot rotate at all as rejected", () => {
    const status = computeConfigStatus(
      device({
        configRev: 4,
        config: { cameraMount: { cameras: { cam0: { rotationDeg: 180 } } } } as Device["config"],
        reportedConfig: {
          ...REPORT_PENDING,
          status: {
            cameraMount: {
              state: "rejected",
              reason: "cam0: the imx477 overlay on this device has no \"rotation\" parameter",
            },
          },
        } as unknown as Device["reportedConfig"],
      })
    )
    expect(status.cameraMount.state).toBe("rejected")
    expect(configStateExplanation(status.cameraMount)).toContain("no \"rotation\" parameter")
  })

  it("is edited on the Media tab, so that tab carries its attention badge", () => {
    expect(NAMESPACE_TABS.cameraMount).toEqual(["media"])
  })
})
