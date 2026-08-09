import { describe, expect, it } from "vitest"
import type { Device } from "./api"
import {
  formatMsisdn,
  groupIccid,
  maskIccid,
  reportedSim,
  reportedUplink,
  simCarrierLabel,
  simCheckedAgo,
  simDisplay,
} from "./device-sim"

/**
 * One case per row of the phase-1 state table, plus the two failure modes that
 * matter more than any of them: "no SIM" must never be shown for a device that
 * simply has not reported, and a device that HAS reported no SIM must say so
 * unmistakably.
 *
 * The frontend vitest runs in a node environment with no DOM (see
 * vitest.config.ts), so the decisions live here as pure functions and the card
 * is a thin renderer over them.
 */

/** A device carrying an arbitrary reported `effective` document. */
function deviceWith(effective: Record<string, unknown>): Device {
  return { reportedConfig: { v: 1, ts: 1, rev: 0, origin: "boot", effective } } as unknown as Device
}

const READY = {
  present: 1,
  state: "ready",
  iccid: "8912230000507537488",
  msisdn: "+14379073824",
  carrier: "Public Mobile",
  act: "lte",
  registration: "home",
  checked_at: "2026-08-09T00:22:44Z",
}

describe("reportedSim", () => {
  it("reads a full block off the device report", () => {
    expect(reportedSim(deviceWith({ sim: READY }))).toEqual({
      present: 1,
      state: "ready",
      iccid: "8912230000507537488",
      msisdn: "+14379073824",
      carrier: "Public Mobile",
      act: "lte",
      registration: "home",
      checkedAt: "2026-08-09T00:22:44Z",
    })
  })

  it("returns null when the device has told us nothing", () => {
    // An older agent, or one that has never connected. NOT "no SIM".
    expect(reportedSim(null)).toBeNull()
    expect(reportedSim(deviceWith({}))).toBeNull()
    expect(reportedSim({ reportedConfig: null } as unknown as Device)).toBeNull()
  })

  it("drops a block it cannot understand rather than half-rendering it", () => {
    expect(reportedSim(deviceWith({ sim: "ready" }))).toBeNull()
    expect(reportedSim(deviceWith({ sim: [] }))).toBeNull()
    expect(reportedSim(deviceWith({ sim: { present: 0 } }))).toBeNull()
    expect(reportedSim(deviceWith({ sim: { state: "wat" } }))).toBeNull()
  })

  it("omits a phone number the carrier never wrote", () => {
    const sim = reportedSim(deviceWith({ sim: { state: "ready", registration: "home" } }))
    expect(sim).not.toHaveProperty("msisdn")
  })

  it("keeps present as null when the modem could not tell", () => {
    expect(reportedSim(deviceWith({ sim: { state: "unknown" } }))?.present).toBeNull()
  })
})

describe("reportedUplink", () => {
  it("reads the primary interface and the modem-only flag", () => {
    expect(reportedUplink(deviceWith({ uplink: { primary: "wlan0", modem_only: 0 } }))).toEqual({
      primary: "wlan0",
      modemOnly: false,
    })
    expect(reportedUplink(deviceWith({ uplink: { primary: "usb0", modem_only: 1 } }))).toEqual({
      primary: "usb0",
      modemOnly: true,
    })
  })

  it("returns null when the device has not reported one", () => {
    expect(reportedUplink(deviceWith({}))).toBeNull()
    expect(reportedUplink(null)).toBeNull()
  })
})

describe("simDisplay — one case per state", () => {
  const of = (sim: Record<string, unknown>) => simDisplay(reportedSim(deviceWith({ sim })))

  it("present + registered reads as active", () => {
    const d = of(READY)
    expect(d.state).toBe("active")
    expect(d.label).toBe("Active")
    expect(d.tone).toBe("ok")
    expect(d.hint).toBeNull()
  })

  it("calls out roaming without calling it a problem", () => {
    const d = of({ ...READY, registration: "roaming" })
    expect(d.state).toBe("active")
    expect(d.label).toBe("Active (roaming)")
    expect(d.tone).toBe("ok")
  })

  it("present + denied names the account, not the antenna", () => {
    const d = of({ ...READY, registration: "denied" })
    expect(d.state).toBe("denied")
    expect(d.label).toMatch(/Rejected by the network/)
    expect(d.hint).toMatch(/account/)
    expect(d.tone).toBe("danger")
  })

  it("present + searching names the antenna, not the account", () => {
    const d = of({ ...READY, registration: "searching" })
    expect(d.state).toBe("searching")
    expect(d.label).toBe("Searching for network")
    expect(d.hint).toMatch(/antenna|coverage/)
    expect(d.tone).toBe("warn")
  })

  it("NOT DETECTED is unmistakable, and is never phrased as a signal problem", () => {
    // The 2026-08-08 case, and the whole justification for the phase.
    const d = of({ present: 0, state: "not-detected", registration: "not-searching" })
    expect(d.state).toBe("not-detected")
    expect(d.label).toBe("No SIM detected")
    expect(d.label).not.toMatch(/signal/i)
    expect(d.hint).toMatch(/seated/)
    expect(d.tone).toBe("danger")
  })

  it("locked says so and does not offer to unlock it", () => {
    const d = of({ present: 1, state: "locked" })
    expect(d.state).toBe("locked")
    expect(d.label).toBe("SIM locked")
    expect(d.tone).toBe("danger")
  })

  it("a card the modem cannot read is an error, not an absence", () => {
    const d = of({ state: "error" })
    expect(d.state).toBe("error")
    expect(d.label).toBe("SIM error")
    expect(d.label).not.toMatch(/No SIM/)
  })

  it("an old daemon renders as unknown, NEVER as no SIM", () => {
    // The distinction the definition of done turns on.
    const d = simDisplay(null)
    expect(d.state).toBe("unknown")
    expect(d.label).toBe("Unknown")
    expect(d.label).not.toMatch(/No SIM/)
    expect(d.tone).toBe("muted")
  })

  it("a modem that did not answer is unknown too, and says as much", () => {
    const d = of({ state: "unknown" })
    expect(d.state).toBe("unknown")
    expect(d.hint).toMatch(/not the same as having no SIM/)
  })

  it("a readable card with no registration reported is 'present', not 'active'", () => {
    const d = of({ present: 1, state: "ready", iccid: "8912230000507537488" })
    expect(d.state).toBe("present")
    expect(d.label).toBe("SIM present")
  })
})

describe("simCheckedAgo — how fresh is this reading", () => {
  const at = (iso: string) => reportedSim(deviceWith({ sim: { ...READY, checked_at: iso } }))
  const NOW = Date.parse("2026-08-09T12:00:00Z")

  it("phrases recent readings in minutes", () => {
    expect(simCheckedAgo(at("2026-08-09T11:56:00Z"), NOW)?.relative).toBe("4 minutes ago")
    expect(simCheckedAgo(at("2026-08-09T11:59:00Z"), NOW)?.relative).toBe("1 minute ago")
    expect(simCheckedAgo(at("2026-08-09T11:59:50Z"), NOW)?.relative).toBe("just now")
  })

  it("rolls up to hours and days", () => {
    expect(simCheckedAgo(at("2026-08-09T09:00:00Z"), NOW)?.relative).toBe("3 hours ago")
    expect(simCheckedAgo(at("2026-08-07T12:00:00Z"), NOW)?.relative).toBe("2 days ago")
  })

  it("carries the exact time for a tooltip", () => {
    expect(simCheckedAgo(at("2026-08-09T11:56:00Z"), NOW)?.exact).toContain("2026")
  })

  it("says nothing when the device clock is clearly wrong", () => {
    // Not hypothetical: a modem that has never been NITZ'd serves 1980, which is
    // why the agent ships a clock stepper at all. "46 years ago" is noise.
    expect(simCheckedAgo(at("1980-01-06T00:00:00Z"), NOW)).toBeNull()
    expect(simCheckedAgo(at("2027-01-01T00:00:00Z"), NOW)).toBeNull()
  })

  it("tolerates ordinary clock skew rather than blanking", () => {
    // A few seconds into the future is two clocks disagreeing, not a fault.
    expect(simCheckedAgo(at("2026-08-09T12:00:20Z"), NOW)?.relative).toBe("just now")
  })

  it("says nothing when there is no timestamp or it is unparseable", () => {
    expect(simCheckedAgo(null, NOW)).toBeNull()
    expect(simCheckedAgo(reportedSim(deviceWith({ sim: { state: "ready" } })), NOW)).toBeNull()
    expect(simCheckedAgo(at("not a date"), NOW)).toBeNull()
  })
})

describe("formatting", () => {
  it("joins carrier and access technology", () => {
    expect(simCarrierLabel(reportedSim(deviceWith({ sim: READY })))).toBe("Public Mobile · LTE")
  })

  it("shows the carrier alone when the access technology is unknown", () => {
    const sim = reportedSim(deviceWith({ sim: { ...READY, act: undefined } }))
    expect(simCarrierLabel(sim)).toBe("Public Mobile")
  })

  it("has no carrier to show when none was reported", () => {
    expect(simCarrierLabel(null)).toBeNull()
    expect(simCarrierLabel(reportedSim(deviceWith({ sim: { state: "not-detected" } })))).toBeNull()
  })

  it("masks an ICCID down to the last four printed on the card", () => {
    expect(maskIccid("8912230000507537488")).toBe("•••• •••• •••• 7488")
  })

  it("groups a revealed ICCID in fours", () => {
    expect(groupIccid("8912230000507537488")).toBe("8912 2300 0050 7537 488")
  })

  it("formats a NANP number and leaves anything else alone", () => {
    expect(formatMsisdn("+14379073824")).toBe("+1 437-907-3824")
    expect(formatMsisdn("+447700900123")).toBe("+447700900123")
    expect(formatMsisdn("4379073824")).toBe("4379073824")
  })
})
