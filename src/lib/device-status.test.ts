import { describe, expect, it } from "vitest"
import type { StatusRun } from "@xorgate/react"
import {
  STATUS_OVERLAY_STORAGE_KEY,
  deviceStatusChipModel,
  deviceStatusDotModel,
  deviceStatusKey,
  readStatusOverlayPref,
  statusRunAt,
  writeStatusOverlayPref,
} from "./device-status"

describe("deviceStatusChipModel", () => {
  it("is hidden while healthy, offline, or without a reading", () => {
    expect(
      deviceStatusChipModel({ ledState: 0, healthFlags: 0, online: true })
    ).toBeNull()
    expect(
      deviceStatusChipModel({ ledState: 3, healthFlags: 4, online: false })
    ).toBeNull()
    expect(deviceStatusChipModel({ ledState: null, online: true })).toBeNull()
    expect(deviceStatusChipModel({ online: true })).toBeNull()
  })

  it("names the state, takes the LED colour and decodes the flags", () => {
    expect(
      deviceStatusChipModel({ ledState: 3, healthFlags: 4 | 8, online: true })
    ).toEqual({
      code: 3,
      label: "Network recovering",
      color: "#a855f7",
      flags: ["LTE down", "Cloud link down"],
    })
    expect(
      deviceStatusChipModel({ ledState: 5, healthFlags: null, online: true })
    ).toMatchObject({
      code: 5,
      label: "Undervoltage",
      color: "#ef4444",
      flags: [],
    })
  })

  it("shows an unknown (newer agent) code in grey rather than hiding it", () => {
    expect(deviceStatusChipModel({ ledState: 9, online: true })).toMatchObject({
      code: 9,
      label: "Unknown (9)",
    })
  })
})

const RUNS: StatusRun[] = [
  { fromTs: 0, toTs: 10_000, code: 0, source: "insight" },
  { fromTs: 10_000, toTs: 25_000, code: 3, source: "insight" },
  { fromTs: 40_000, toTs: 50_000, code: 0, source: "insight" },
  { fromTs: 50_000, toTs: 52_000, code: 5, source: "insight" },
]

describe("statusRunAt", () => {
  it("finds the run under a timestamp, half-open, null in gaps", () => {
    expect(statusRunAt(RUNS, 0)?.code).toBe(0)
    expect(statusRunAt(RUNS, 10_000)?.code).toBe(3)
    expect(statusRunAt(RUNS, 24_999)?.code).toBe(3)
    expect(statusRunAt(RUNS, 30_000)).toBeNull()
    expect(statusRunAt(RUNS, 51_000)?.code).toBe(5)
    expect(statusRunAt(RUNS, 52_000)).toBeNull()
    expect(statusRunAt([], 1)).toBeNull()
  })
})

describe("deviceStatusKey", () => {
  it("lists every code by severity with its LED colour and a meaning", () => {
    const key = deviceStatusKey()
    expect(key.map((k) => k.code)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(key[0]).toMatchObject({ label: "Healthy", color: "#22c55e" })
    expect(key[3]).toMatchObject({
      label: "Network recovering",
      color: "#a855f7",
    })
    expect(key[3].meaning).toMatch(/LTE or the cloud link is down/)
    for (const k of key) expect(k.meaning.length).toBeGreaterThan(10)
  })
})

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

describe("status overlay preference", () => {
  it("defaults off, persists on, and survives a throwing storage", () => {
    const store = memoryStorage()
    expect(readStatusOverlayPref(store)).toBe(false)
    writeStatusOverlayPref(true, store)
    expect(store.getItem(STATUS_OVERLAY_STORAGE_KEY)).toBe("1")
    expect(readStatusOverlayPref(store)).toBe(true)
    writeStatusOverlayPref(false, store)
    expect(readStatusOverlayPref(store)).toBe(false)

    const broken = {
      getItem: () => {
        throw new Error("SecurityError")
      },
      setItem: () => {
        throw new Error("QuotaExceededError")
      },
    }
    expect(readStatusOverlayPref(broken)).toBe(false)
    expect(() => writeStatusOverlayPref(true, broken)).not.toThrow()
    expect(readStatusOverlayPref(null)).toBe(false)
  })
})

describe("deviceStatusDotModel", () => {
  it("shows healthy as green, with no faults", () => {
    expect(
      deviceStatusDotModel({ ledState: 0, healthFlags: 0, online: true })
    ).toMatchObject({
      code: 0,
      label: "Healthy",
      color: "#22c55e",
      faults: [],
    })
  })

  it("carries the meaning and the decoded faults when unhealthy", () => {
    const m = deviceStatusDotModel({
      ledState: 3,
      healthFlags: 4 | 8,
      online: true,
    })
    expect(m).toMatchObject({
      code: 3,
      color: "#a855f7",
      faults: ["LTE down", "Cloud link down"],
    })
    expect(m?.meaning).toMatch(/LTE or the cloud link is down/)
  })

  it("is hidden offline or without a reading", () => {
    expect(deviceStatusDotModel({ ledState: 5, online: false })).toBeNull()
    expect(deviceStatusDotModel({ ledState: null, online: true })).toBeNull()
    expect(deviceStatusDotModel({ online: true })).toBeNull()
  })
})
