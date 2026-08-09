import { describe, expect, it } from "vitest"
import type { Device } from "./api"
import {
  apnInputError,
  apnMachineNote,
  apnSaveGate,
  reportedApn,
  type ReportedApn,
} from "./device-apn"
import type { ReportedUplink } from "./device-sim"

/**
 * The APN card's decisions (manage_sim_card_info, Phase 2). The one that
 * matters most: a device reporting NO apn machinery has NO rollback safety
 * net, and the save must be hard-blocked — showing it the danger dialog
 * ("the device will restore itself") would be a lie.
 */

function deviceWith(effective: Record<string, unknown>): Device {
  return { reportedConfig: { v: 1, ts: 1, rev: 0, origin: "boot", effective } } as unknown as Device
}

const IN_FORCE: ReportedApn = { state: "in-force", applied: "sp.mb.com", fails: 0 }
const ROLLED_BACK: ReportedApn = {
  state: "rolled-back",
  applied: "sp.mb.com",
  requested: "wrong.apn",
  lastError: "no data session within 300s (ping and tcp both failed)",
  fails: 1,
}
const WIFI: ReportedUplink = { primary: "wlan0", modemOnly: false }
const LTE_ONLY: ReportedUplink = { primary: "usb0", modemOnly: true }

describe("reportedApn", () => {
  it("reads a full machinery block", () => {
    expect(
      reportedApn(
        deviceWith({
          apn: {
            state: "rolled-back",
            apn_applied: "sp.mb.com",
            apn_requested: "wrong.apn",
            last_error: "no data session within 300s (ping and tcp both failed)",
            fails: 1,
            changed_at: "2026-08-09T18:00:00Z",
          },
        })
      )
    ).toEqual({ ...ROLLED_BACK, changedAt: "2026-08-09T18:00:00Z" })
  })

  it("returns null for a device that has never reported the machinery", () => {
    expect(reportedApn(null)).toBeNull()
    expect(reportedApn(deviceWith({}))).toBeNull()
    expect(reportedApn(deviceWith({ apn: { state: "confused" } }))).toBeNull()
    expect(reportedApn(deviceWith({ apn: "sp.mb.com" }))).toBeNull()
  })
})

describe("apnSaveGate — friction scaled to the risk", () => {
  it("HARD-BLOCKS a device with no reported machinery (no rollback net)", () => {
    const gate = apnSaveGate(null, WIFI)
    expect(gate.kind).toBe("blocked")
    if (gate.kind === "blocked") expect(gate.reason).toContain("strand")
  })

  it("demands the typed confirmation when cellular is the only link", () => {
    expect(apnSaveGate(IN_FORCE, LTE_ONLY).kind).toBe("danger")
  })

  it("fails SAFE when the uplink is unknown — assume cellular-only", () => {
    expect(apnSaveGate(IN_FORCE, null).kind).toBe("danger")
  })

  it("plain confirmation when a second link exists", () => {
    expect(apnSaveGate(IN_FORCE, WIFI).kind).toBe("confirm")
  })
})

describe("apnMachineNote — the machinery's last word, rendered honestly", () => {
  it("says nothing when the APN is simply in force", () => {
    expect(apnMachineNote(IN_FORCE)).toBeNull()
    expect(apnMachineNote(null)).toBeNull()
  })

  it("an in-flight apply reads as a warning, not a success", () => {
    const note = apnMachineNote({ state: "applying", requested: "new.apn" })
    expect(note?.tone).toBe("warn")
    expect(note?.text).toContain('"new.apn"')
  })

  it("a rollback names what was tried, what is running, and why", () => {
    const note = apnMachineNote(ROLLED_BACK)
    expect(note?.tone).toBe("danger")
    expect(note?.text).toContain('"wrong.apn"')
    expect(note?.text).toContain('"sp.mb.com"')
    expect(note?.text).toContain("no data session")
  })

  it("a rejection tells the operator the value must CHANGE to retry", () => {
    const note = apnMachineNote({
      state: "rejected",
      applied: "sp.mb.com",
      requested: "wrong.apn",
      fails: 3,
    })
    expect(note?.tone).toBe("danger")
    expect(note?.text).toContain("3 failed attempts")
    expect(note?.text).toContain("different value")
  })
})

describe("apnInputError", () => {
  it("accepts hostname-ish values and the empty string", () => {
    expect(apnInputError("")).toBeNull()
    expect(apnInputError("sp.mb.com")).toBeNull()
    expect(apnInputError("m2m-east.telus.iot")).toBeNull()
  })

  it("rejects anything outside the AT-safe charset", () => {
    expect(apnInputError('a";+CFUN=0')).toContain("letters")
    expect(apnInputError("a b")).toContain("letters")
    expect(apnInputError("a".repeat(101))).toContain("100")
  })
})
