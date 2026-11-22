import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import contract from "@/lib/config-contract.json"
import {
  DEFAULT_IMU_MOUNT,
  DEFAULT_IMU_VIEW,
  DEFAULT_LTE_DEADZONE_PROFILE,
  DEFAULT_TIME_SYNC_OFFLINE_SOURCES,
  resolveRecording,
} from "@/lib/device-config-defaults"
import { CONFIG_NAMESPACES, NAMESPACE_TABS } from "@/lib/device-config-status"

// The committed copy of the backend's generated device-config contract. The
// web app has no defaults of its own any more — everything a control shows for
// an unconfigured device comes from here, so these assertions are what stop the
// UI claiming a device is doing something it isn't.

// `XORGATE_BACKEND_DIR` points the check at another backend checkout: a
// worktree of this repo is otherwise compared with the backend's MAIN checkout,
// which lags the backend branch that generated this copy until that branch
// merges (the usual state of a cross-repo phase).
const BACKEND_DIR =
  process.env.XORGATE_BACKEND_DIR ??
  resolve(__dirname, "../../../../backend/xorgate-core-service")
const BACKEND_COPY = resolve(
  BACKEND_DIR,
  "src/config-registry/config-contract.json"
)

describe("config-contract.json", () => {
  it("is in sync with the backend copy", () => {
    // Skipped in a web-only checkout (the three packages are separate repos in
    // one working tree). The authoritative staleness guard is the backend's own
    // regenerate-and-diff test; this catches a stale copy here.
    if (!existsSync(BACKEND_COPY)) {
      expect(contract.version).toBe(1)
      return
    }
    expect(JSON.parse(readFileSync(BACKEND_COPY, "utf8"))).toEqual(contract)
  })

  it("carries the namespaces the settings tabs render", () => {
    // `simulation` is accepted only for simulated devices
    // (plans/xorgate-device-simulator); its settings card is Phase 5's.
    // `obd` only for a model declaring `peripherals.obd`
    // (plans/obd2-bluetooth-integration); its card is the Peripherals tab.
    // `cameraSensors` only for a real device on a Rust agent that advertises
    // `camera.sensors` (plans/support-other-camera-models); its card is on
    // the Media tab.
    expect(Object.keys(contract.namespaces).sort()).toEqual([
      "cameraMount",
      "cameraSensors",
      "cellular",
      "gnssAntBias",
      "imuMount",
      "lteRecovery",
      "obd",
      "recording",
      "simulation",
      "timeSync",
    ])
  })

  it("lists exactly the namespaces the status rail computes", () => {
    // A namespace the contract has and the rail lacks would never get a badge;
    // one the rail has and the contract lacks would have no defaults to
    // compare against.
    expect([...CONFIG_NAMESPACES].sort()).toEqual(
      Object.keys(contract.namespaces).sort()
    )
    expect(Object.keys(NAMESPACE_TABS).sort()).toEqual(
      [...CONFIG_NAMESPACES].sort()
    )
  })

  it("types cameraSensors as the console builds it", () => {
    // The sensor id list is NOT in the contract (the catalog is what moves);
    // an unmanaged device holds no port, which is also the default.
    const ns = contract.namespaces.cameraSensors
    expect(ns.defaults).toEqual({ cameras: {} })
    const entry = ns.jsonSchema.properties.cameras.additionalProperties
    expect(Object.keys(entry.properties).sort()).toEqual(["options", "sensor"])
    expect(entry.required).toEqual(["sensor"])
    expect(entry.additionalProperties).toBe(false)
    expect("enum" in entry.properties.sensor).toBe(false)
  })

  it("feeds the exported defaults", () => {
    expect(DEFAULT_IMU_MOUNT).toEqual(contract.namespaces.imuMount.defaults)
    expect(DEFAULT_IMU_VIEW).toEqual(contract.uiPrefs.defaults.imuView)
    expect(DEFAULT_LTE_DEADZONE_PROFILE).toBe(
      contract.namespaces.lteRecovery.defaults.deadZoneProfile
    )
    expect(DEFAULT_TIME_SYNC_OFFLINE_SOURCES).toBe(
      contract.namespaces.timeSync.defaults.offlineSources
    )
  })

  it("resolves an unconfigured device to the device's own defaults", () => {
    const d = contract.namespaces.recording.defaults
    const r = resolveRecording(null)
    expect(r.telemetryEnabled).toBe(d.telemetry.enabled)
    expect(r.rateHz).toBe(d.telemetry.rateHz)
    expect(r.videoEnabled).toBe(d.video.enabled)
    expect(r.preset).toBe(d.video.preset)
    expect(r.segmentSeconds).toBe(d.video.segmentSeconds)
    expect(r.bootDefer).toBe(d.video.bootDefer)
    expect(r.bootDeferMaxSecs).toBe(d.video.bootDeferMaxSecs)
    expect(r.gpsGate).toBe(d.video.gpsGate)
    expect(r.gpsGateMaxSecs).toBe(d.video.gpsGateMaxSecs)
    expect(r.gpsGateNoProgressSecs).toBe(d.video.gpsGateNoProgressSecs)
    expect(r.uploadMode).toBe(d.upload.mode)
    expect(r.maxBytes).toBe(d.retention.maxBytes)
    expect(r.powerSheddingEnabled).toBe(d.powerShedding.enabled)
    expect(r.cpuTempC).toBe(d.powerShedding.cpuTempC)
    expect(r.cpuTempRestoreC).toBe(d.powerShedding.cpuTempRestoreC)
    expect(r.cpuTempSecs).toBe(d.powerShedding.cpuTempSecs)
  })

  it("keeps the two knobs the UI does not edit un-defaulted", () => {
    // Defaulting these would materialize them into every save, freezing today's
    // device default into the stored config for the whole fleet.
    const r = resolveRecording(null)
    expect(r.bootDeferMinBudgetMa).toBeUndefined()
    expect(r.spawnStaggerSecs).toBeUndefined()
    expect(r.minFreeBytes).toBeUndefined()
  })

  it("offers exactly the presets the backend accepts", () => {
    const schema = contract.namespaces.recording.jsonSchema as {
      properties: { video: { properties: { preset: { enum: string[] } } } }
    }
    expect(schema.properties.video.properties.preset.enum).toContain(
      contract.namespaces.recording.defaults.video.preset
    )
  })
})
