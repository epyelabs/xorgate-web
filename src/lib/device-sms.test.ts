import { describe, expect, it } from "vitest"
import type { Device } from "@xorgate/sdk"
import type { SmsMessage, SmsRead, SmsReadResult } from "./device-sms-api"
import {
  DEFAULT_SMS_LIMIT,
  SMS_CLEAR_AGENT_REASON,
  SMS_CLEAR_CAPABILITY,
  SMS_CLEAR_ROLE_REASON,
  isSmsClear,
  isSmsReadPending,
  parseSmsLimit,
  smsAgo,
  smsCapability,
  smsClearConfirmText,
  smsClearGate,
  smsClearedToast,
  smsClearedTotal,
  smsDisplayedRead,
  smsFullStoreWarnings,
  smsReadFailureMessage,
  smsSenderLabel,
  smsShowingLabel,
  smsStorageSummary,
  smsTags,
  sortSmsMessages,
} from "./device-sms"

/**
 * The Messages sheet's decisions (plans/device-sms-inbox §4). The frontend
 * vitest runs without a DOM, so the sheet is a thin renderer over these.
 */

function deviceWith(effective: Record<string, unknown>): Device {
  return {
    reportedConfig: { v: 1, ts: 1, rev: 0, origin: "boot", effective },
  } as unknown as Device
}

function msg(over: Partial<SmsMessage> = {}): SmsMessage {
  return {
    id: "SM:1",
    storage: "SM",
    indexes: [1],
    from: "+14379073824",
    fromType: "international",
    sentAt: "2026-08-11T20:05:59-04:00",
    unread: false,
    text: "hello",
    binary: false,
    incomplete: false,
    truncated: false,
    ...over,
  }
}

function result(over: Partial<SmsReadResult> = {}): SmsReadResult {
  return {
    storage: {},
    total: 1,
    skipped: 0,
    partial: false,
    durationMs: 3500,
    messages: [msg()],
    ...over,
  }
}

function read(over: Partial<SmsRead> = {}): SmsRead {
  return {
    id: "r1",
    deviceId: "d1",
    action: "read",
    status: "ok",
    errorCode: null,
    errorMessage: null,
    limit: 10,
    requestedBy: "u1",
    createdAt: "2026-10-01T18:00:00.000Z",
    completedAt: "2026-10-01T18:00:04.000Z",
    result: result(),
    ...over,
  }
}

describe("smsCapability", () => {
  it("is yes when the agent advertises sms.read", () => {
    expect(
      smsCapability(deviceWith({ agent: { mode: "live", capabilities: ["sms.read"] } }))
    ).toBe("yes")
  })

  it("is no for an agent block without the capability (an older build)", () => {
    expect(smsCapability(deviceWith({ agent: { mode: "live" } }))).toBe("no")
    expect(
      smsCapability(deviceWith({ agent: { capabilities: ["other"] } }))
    ).toBe("no")
    // Not an array: the backend rule says unsupported, so do we.
    expect(
      smsCapability(deviceWith({ agent: { capabilities: "sms.read" } }))
    ).toBe("no")
  })

  it("is unknown when the device never reported an agent block", () => {
    expect(smsCapability(deviceWith({}))).toBe("unknown")
    expect(smsCapability(null)).toBe("unknown")
    expect(smsCapability({ reportedConfig: null } as unknown as Device)).toBe(
      "unknown"
    )
  })
})

describe("parseSmsLimit", () => {
  it("accepts the menu values, from storage strings too", () => {
    expect(parseSmsLimit("25")).toBe(25)
    expect(parseSmsLimit(50)).toBe(50)
  })

  it("falls back to 10 for anything else", () => {
    expect(parseSmsLimit(null)).toBe(DEFAULT_SMS_LIMIT)
    expect(parseSmsLimit("12")).toBe(10)
    expect(parseSmsLimit("abc")).toBe(10)
    expect(parseSmsLimit(500)).toBe(10)
  })
})

describe("sortSmsMessages", () => {
  it("orders newest first across offsets, undecodable stamps last, ties stable", () => {
    const a = msg({ id: "a", sentAt: "2026-08-11T20:00:00-04:00" }) // 00:00Z
    const b = msg({ id: "b", sentAt: "2026-08-12T01:00:00+00:00" }) // 01:00Z
    const c = msg({ id: "c", sentAt: null })
    const d = msg({ id: "d", sentAt: "garbage" })
    const e = msg({ id: "e", sentAt: "2026-08-12T00:00:00Z" }) // ties a
    expect(sortSmsMessages([c, a, d, b, e]).map((m) => m.id)).toEqual([
      "b",
      "a",
      "e",
      "c",
      "d",
    ])
  })

  it("does not mutate its input", () => {
    const list = [msg({ id: "x", sentAt: null }), msg({ id: "y" })]
    sortSmsMessages(list)
    expect(list.map((m) => m.id)).toEqual(["x", "y"])
  })
})

describe("smsSenderLabel", () => {
  it("formats NANP numbers and leaves other numbers alone", () => {
    expect(smsSenderLabel({ from: "+14379073824", fromType: "international" })).toBe(
      "+1 437-907-3824"
    )
    expect(smsSenderLabel({ from: "+639171234567", fromType: "international" })).toBe(
      "+639171234567"
    )
    expect(smsSenderLabel({ from: "4379073824", fromType: "national" })).toBe(
      "4379073824"
    )
  })

  it("shows alphanumeric senders verbatim, and names a blank one", () => {
    expect(smsSenderLabel({ from: "Rogers", fromType: "alphanumeric" })).toBe("Rogers")
    expect(smsSenderLabel({ from: "  ", fromType: "other" })).toBe("Unknown sender")
  })
})

describe("smsTags", () => {
  it("names the store first, then each flag", () => {
    expect(smsTags(msg())).toEqual(["SIM"])
    expect(
      smsTags(msg({ storage: "ME", incomplete: true, truncated: true, binary: true }))
    ).toEqual(["Modem", "Incomplete", "Truncated", "Binary"])
  })
})

describe("smsFullStoreWarnings", () => {
  it("warns for each full store (the bench's ME is 23/23)", () => {
    expect(
      smsFullStoreWarnings({
        SM: { used: 7, total: 40 },
        ME: { used: 23, total: 23 },
      })
    ).toEqual(["Modem storage is full (23/23). New messages may not arrive."])
    expect(smsFullStoreWarnings({ SM: { used: 40, total: 40 } })).toEqual([
      "SIM storage is full (40/40). New messages may not arrive.",
    ])
  })

  it("is quiet for room to spare, a zero-size store, or no storage", () => {
    expect(smsFullStoreWarnings({ SM: { used: 0, total: 0 } })).toEqual([])
    expect(smsFullStoreWarnings({ ME: { used: 22, total: 23 } })).toEqual([])
    expect(smsFullStoreWarnings(null)).toEqual([])
  })
})

describe("smsShowingLabel", () => {
  it("says how much of the store the list is", () => {
    expect(
      smsShowingLabel(result({ total: 30, messages: Array(10).fill(msg()) }))
    ).toBe("showing 10 of 30")
    expect(smsShowingLabel(result({ total: 1 }))).toBe("showing all 1")
    expect(smsShowingLabel(result({ total: 0, messages: [] }))).toBe("showing all 0")
  })
})

describe("smsReadFailureMessage", () => {
  it("is null for pending and ok", () => {
    expect(smsReadFailureMessage({ status: "pending", errorCode: null })).toBeNull()
    expect(smsReadFailureMessage({ status: "ok", errorCode: null })).toBeNull()
  })

  it("explains each failure", () => {
    expect(smsReadFailureMessage({ status: "expired", errorCode: "timeout" })).toBe(
      "The device didn't answer in time."
    )
    expect(smsReadFailureMessage({ status: "error", errorCode: "no_sim" })).toMatch(
      /No SIM card/
    )
    expect(smsReadFailureMessage({ status: "error", errorCode: "no_modem" })).toMatch(
      /modem/
    )
    expect(smsReadFailureMessage({ status: "error", errorCode: "modem_busy" })).toMatch(
      /busy/
    )
    expect(smsReadFailureMessage({ status: "error", errorCode: null })).toBe(
      "The device couldn't read its messages."
    )
  })
})

describe("smsDisplayedRead", () => {
  it("prefers a fresh ok read, else the stored one, else nothing", () => {
    const stored = read({ id: "old" })
    const fresh = read({ id: "new" })
    expect(smsDisplayedRead(stored, fresh)?.id).toBe("new")
    expect(smsDisplayedRead(stored, read({ id: "p", status: "pending", result: null }))?.id).toBe(
      "old"
    )
    expect(
      smsDisplayedRead(stored, read({ status: "expired", errorCode: "timeout", result: null }))?.id
    ).toBe("old")
    expect(smsDisplayedRead(null, undefined)).toBeNull()
    expect(smsDisplayedRead(undefined, read({ status: "error", result: null }))).toBeNull()
  })

  it("tracks pending", () => {
    expect(isSmsReadPending(read({ status: "pending" }))).toBe(true)
    expect(isSmsReadPending(read())).toBe(false)
    expect(isSmsReadPending(undefined)).toBe(false)
  })
})

describe("smsAgo", () => {
  const now = Date.parse("2026-10-01T18:00:16.000Z")
  it("uses the relative-time scale", () => {
    expect(smsAgo("2026-10-01T18:00:04.000Z", now)).toBe("12s ago")
    expect(smsAgo("2026-09-28T18:00:00.000Z", now)).toBe("3d ago")
  })
  it("is null for no stamp or a broken one", () => {
    expect(smsAgo(null, now)).toBeNull()
    expect(smsAgo("nope", now)).toBeNull()
  })
})

// plans/device-sms-clear

describe("smsCapability for sms.clear", () => {
  it("checks the named capability", () => {
    const both = deviceWith({ agent: { capabilities: ["sms.read", "sms.clear"] } })
    const readOnly = deviceWith({ agent: { capabilities: ["sms.read"] } })
    expect(smsCapability(both, SMS_CLEAR_CAPABILITY)).toBe("yes")
    expect(smsCapability(readOnly, SMS_CLEAR_CAPABILITY)).toBe("no")
    expect(smsCapability(readOnly)).toBe("yes")
    expect(smsCapability(deviceWith({}), SMS_CLEAR_CAPABILITY)).toBe("unknown")
  })
})

describe("smsClearedTotal / smsClearedToast", () => {
  it("sums the stores", () => {
    expect(smsClearedTotal({ SM: 7, ME: 23 })).toBe(30)
    expect(smsClearedTotal({ ME: 0 })).toBe(0)
    expect(smsClearedTotal({})).toBe(0)
  })
  it("ignores junk", () => {
    expect(
      smsClearedTotal({ SM: -1, ME: Number.NaN } as unknown as { SM: number })
    ).toBe(0)
    expect(smsClearedTotal({ SM: "4" } as unknown as { SM: number })).toBe(0)
  })
  it("is null without counts", () => {
    expect(smsClearedTotal(undefined)).toBeNull()
    expect(smsClearedTotal(null)).toBeNull()
  })
  it("reads as a sentence", () => {
    expect(smsClearedToast({ SM: 7, ME: 23 })).toBe("Cleared 30 messages")
    expect(smsClearedToast({ ME: 1 })).toBe("Cleared 1 message")
    expect(smsClearedToast({})).toBe("Cleared 0 messages")
    expect(smsClearedToast(undefined)).toBe("Messages cleared")
  })
})

describe("smsClearConfirmText", () => {
  it("names the count when known", () => {
    expect(smsClearConfirmText(30)).toBe(
      "This deletes all 30 messages from this device's SIM and modem."
    )
    expect(smsClearConfirmText(1)).toBe(
      "This deletes the 1 message on this device's SIM and modem."
    )
  })
  it("drops the number when unknown or zero", () => {
    for (const n of [null, undefined, 0, Number.NaN]) {
      expect(smsClearConfirmText(n)).toBe(
        "This deletes all messages from this device's SIM and modem."
      )
    }
  })
  it("never uses an em-dash", () => {
    expect(smsClearConfirmText(5)).not.toMatch(/\u2014/)
  })
})

describe("smsClearGate", () => {
  const ok = { role: "owner", capability: "yes", online: true, busy: false } as const
  it("arms for owners and admins", () => {
    expect(smsClearGate(ok)).toEqual({ allowed: true, reason: null })
    expect(smsClearGate({ ...ok, role: "admin" }).allowed).toBe(true)
    // an agent that never reported: the API's 409 decides
    expect(smsClearGate({ ...ok, capability: "unknown" }).allowed).toBe(true)
  })
  it("refuses other roles, and a role still loading", () => {
    for (const role of ["member", "viewer", null, undefined] as const) {
      expect(smsClearGate({ ...ok, role })).toEqual({
        allowed: false,
        reason: SMS_CLEAR_ROLE_REASON,
      })
    }
  })
  it("refuses an old agent, offline, and a request in flight, in that order", () => {
    expect(smsClearGate({ ...ok, capability: "no", online: false, busy: true }).reason).toBe(
      SMS_CLEAR_AGENT_REASON
    )
    expect(smsClearGate({ ...ok, online: false, busy: true }).reason).toBe(
      "The device is offline"
    )
    expect(smsClearGate({ ...ok, busy: true }).allowed).toBe(false)
  })
  it("puts role first", () => {
    expect(
      smsClearGate({ role: "member", capability: "no", online: false, busy: true }).reason
    ).toBe(SMS_CLEAR_ROLE_REASON)
  })
})

describe("clear rows", () => {
  it("tells a clear from a read", () => {
    expect(isSmsClear({ action: "clear" })).toBe(true)
    expect(isSmsClear({ action: "read" })).toBe(false)
    expect(isSmsClear({})).toBe(false)
    expect(isSmsClear(null)).toBe(false)
  })
  it("explains a failed clear with the device's error", () => {
    expect(
      smsReadFailureMessage({
        status: "error",
        errorCode: "error",
        errorMessage: "delete ME failed",
        action: "clear",
      })
    ).toBe(
      "The device couldn't clear every message (delete ME failed). Some may already be deleted."
    )
    expect(
      smsReadFailureMessage({ status: "error", errorCode: "error", errorMessage: null, action: "clear" })
    ).toBe("The device couldn't clear every message. Some may already be deleted.")
    expect(
      smsReadFailureMessage({ status: "error", errorCode: "no_sim", action: "clear" })
    ).toMatch(/to clear/)
    // a read keeps its own copy
    expect(
      smsReadFailureMessage({ status: "error", errorCode: "error", errorMessage: "x" })
    ).toBe("The device couldn't read its messages.")
  })
})

describe("smsStorageSummary", () => {
  it("lists the stores that answered, SIM first", () => {
    expect(
      smsStorageSummary({ ME: { used: 0, total: 23 }, SM: { used: 0, total: 40 } })
    ).toBe("SIM 0/40 · Modem 0/23")
    expect(smsStorageSummary({ ME: { used: 3, total: 23 } })).toBe("Modem 3/23")
  })
  it("is null when nothing answered", () => {
    expect(smsStorageSummary({})).toBeNull()
    expect(smsStorageSummary(null)).toBeNull()
  })
})
