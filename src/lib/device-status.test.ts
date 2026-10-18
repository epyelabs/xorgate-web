import { describe, expect, it } from "vitest"
import type { StatusRun } from "@xorgate/react"
import {
  deviceStatusChipModel,
  statusLegend,
  statusRunAt,
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

describe("statusLegend", () => {
  it("lists only the codes present, by severity, with their total time", () => {
    expect(statusLegend(RUNS)).toEqual([
      { code: 0, label: "Healthy", color: "#22c55e", totalMs: 20_000 },
      {
        code: 3,
        label: "Network recovering",
        color: "#a855f7",
        totalMs: 15_000,
      },
      { code: 5, label: "Undervoltage", color: "#ef4444", totalMs: 2_000 },
    ])
    expect(statusLegend([])).toEqual([])
  })
})
