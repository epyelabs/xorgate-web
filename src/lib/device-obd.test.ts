import { describe, expect, it } from "vitest"
import type { Device, IoCapabilities } from "@xorgate/sdk"
import contract from "@/lib/config-contract.json"
import {
  buildObdConfig,
  forgetObdConfig,
  isScanAfter,
  macInputError,
  normalizeMac,
  obdCapability,
  obdProfileSummary,
  obdScanBlocker,
  obdStatusDisplay,
  pinInputError,
  reportedObd,
  resolveObd,
  selectedObdFields,
} from "./device-obd"

/**
 * The Peripherals tab's decisions (obd2-bluetooth-integration P3). The ones that
 * matter: a device that has reported NO obd block renders as unknown, never
 * as "no adapter"; a save always carries the whole namespace; and "Forget"
 * leaves polling off with no adapter so the retained config cannot re-pair.
 */

function deviceWith(effective: Record<string, unknown>): Device {
  return { reportedConfig: { v: 1, ts: 1, rev: 0, origin: "boot", effective } } as unknown as Device
}

// The bench device's report with the adapter absent (p3-device evidence).
const BENCH = {
  enabled: true,
  adapterMac: "10:21:3E:4F:33:65",
  pin: "1234",
  pollHz: 1,
  fields: [],
  powerSource: "switched",
  status: "backoff",
  link: 0,
  source: "settings",
  adapter: { mac: "10:21:3E:4F:33:65" },
  audit: {
    counters: { requests: 12, ok: 0, no_data: 0, timeouts: 12, err_adapter: 3, reconnects: 2, forbidden_attempts: 1, budget_violations: 2 },
    inventory: { ATZ: 3, "0100": 9 },
    last_stop: { ts: 1_760_000_000_000, reason: "adapter unreachable" },
  },
  scan: {
    ts: 1_760_000_100_000,
    candidates: [
      { mac: "10:21:3e:4f:33:65", name: "V-LINK", rssi: -61 },
      { mac: "00:1D:A5:68:98:8B", name: "EOSR50V_52654C" },
      { name: "no-mac" },
    ],
  },
  helper_version: "0.3.0",
}

describe("obdCapability", () => {
  it("reads a v2 peripherals.obd declaration", () => {
    const caps = {
      schemaVersion: 2,
      system: { fields: [] },
      peripherals: { obd: { adapter: "elm327", transport: "bt-spp", fields: ["rpm", "speed"] } },
    } as unknown as IoCapabilities
    expect(obdCapability(caps)?.fields).toEqual(["rpm", "speed"])
  })
  it("is null for a v1 document, a v2 without peripherals, and no model", () => {
    expect(obdCapability({ schemaVersion: 1 } as unknown as IoCapabilities)).toBeNull()
    expect(obdCapability({ schemaVersion: 2, system: { fields: [] } } as unknown as IoCapabilities)).toBeNull()
    expect(obdCapability(null)).toBeNull()
  })
})

describe("resolveObd / buildObdConfig", () => {
  it("resolves nothing stored to the contract defaults", () => {
    expect(resolveObd(null)).toEqual(contract.namespaces.obd.defaults)
  })
  it("keeps a stored null adapter (not the default) and fills the rest", () => {
    const r = resolveObd({ enabled: true, adapterMac: null })
    expect(r.enabled).toBe(true)
    expect(r.adapterMac).toBeNull()
    expect(r.pollHz).toBe(contract.namespaces.obd.defaults.pollHz)
  })
  it("builds the WHOLE namespace, because the backend replaces it whole", () => {
    const cfg = buildObdConfig(resolveObd({ adapterMac: "10:21:3E:4F:33:65" }))
    expect(Object.keys(cfg).sort()).toEqual(["adapterMac", "enabled", "fields", "pin", "pollHz", "powerSource"])
  })
  it("forget turns polling off and drops the adapter, keeping the rest", () => {
    const cfg = forgetObdConfig(resolveObd({ enabled: true, adapterMac: "10:21:3E:4F:33:65", pin: "0000", pollHz: 2 }))
    expect(cfg).toEqual({ enabled: false, adapterMac: null, pin: "0000", pollHz: 2, fields: [], powerSource: "switched" })
  })
})

describe("MAC and PIN input", () => {
  it("normalizes label spellings to the stored uppercase form", () => {
    expect(normalizeMac(" 10:21:3e:4f:33:65 ")).toBe("10:21:3E:4F:33:65")
    expect(normalizeMac("10-21-3e-4f-33-65")).toBe("10:21:3E:4F:33:65")
    expect(normalizeMac("10213e4f3365")).toBe("10:21:3E:4F:33:65")
    expect(normalizeMac("nonsense")).toBe("NONSENSE")
  })
  it("accepts empty (no adapter) and a MAC, rejects the rest", () => {
    expect(macInputError("")).toBeNull()
    expect(macInputError("10:21:3E:4F:33:65")).toBeNull()
    expect(macInputError("10:21:3E:4F:33")).toMatch(/six pairs/)
    expect(macInputError("V-LINK")).toMatch(/six pairs/)
  })
  it("takes a 4 to 6 digit PIN only", () => {
    expect(pinInputError("1234")).toBeNull()
    expect(pinInputError("123456")).toBeNull()
    expect(pinInputError("123")).not.toBeNull()
    expect(pinInputError("12a4")).not.toBeNull()
    expect(pinInputError("1234567")).not.toBeNull()
  })
  it("narrows the stored field list to what the model declares, in model order", () => {
    expect(selectedObdFields(["speed", "rpm", "gear"], ["rpm", "speed", "coolant_temp"])).toEqual(["rpm", "speed"])
  })
})

describe("reportedObd", () => {
  it("is null without a report, and never 'no adapter'", () => {
    expect(reportedObd(null)).toBeNull()
    expect(reportedObd(deviceWith({}))).toBeNull()
    expect(reportedObd(deviceWith({ obd: { status: "bogus", link: 0 } }))).toBeNull()
    expect(obdStatusDisplay(null).label).toBe("Unknown")
  })
  it("reads the bench report: status, link, source, adapter, audit, scan", () => {
    const obd = reportedObd(deviceWith({ obd: BENCH }))!
    expect(obd.status).toBe("backoff")
    expect(obd.link).toBe(0)
    expect(obd.source).toBe("settings")
    expect(obd.adapterMac).toBe("10:21:3E:4F:33:65")
    expect(obd.enabled).toBe(true)
    expect(obd.helperVersion).toBe("0.3.0")
    expect(obd.profile).toBeNull()
    expect(obd.audit).toEqual({
      requests: 12,
      ok: 0,
      noData: 0,
      timeouts: 12,
      reconnects: 2,
      forbidden: 3,
      inventorySize: 2,
      lastStop: { ts: 1_760_000_000_000, reason: "adapter unreachable" },
    })
    // Candidates: MAC uppercased, missing name/rssi null, no-MAC entry dropped.
    expect(obd.scan).toEqual({
      ts: 1_760_000_100_000,
      error: null,
      candidates: [
        { mac: "10:21:3E:4F:33:65", name: "V-LINK", rssi: -61 },
        { mac: "00:1D:A5:68:98:8B", name: "EOSR50V_52654C", rssi: null },
      ],
    })
  })
  it("clamps an unknown link to 0 and tolerates a missing audit/scan", () => {
    const obd = reportedObd(deviceWith({ obd: { status: "live", link: 7 } }))!
    expect(obd.link).toBe(0)
    expect(obd.audit).toBeNull()
    expect(obd.scan).toBeNull()
    expect(obd.source).toBeNull()
  })
  it("summarizes a probed profile", () => {
    const obd = reportedObd(
      deviceWith({
        obd: {
          status: "live",
          link: 2,
          profile: {
            protocol: { dp: "ISO 15765-4 (CAN 11/500)", dpn: "6" },
            responders: ["7E8", "7E9"],
            supported_fields: ["rpm", "speed"],
            unsupported_fields: ["gear"],
            powertrain: "ice",
            adapter: { ati: "ELM327 v1.5" },
          },
        },
      })
    )!
    expect(obdProfileSummary(obd.profile)).toBe("ISO 15765-4 (CAN 11/500) · ECUs 7E8,7E9 · 2/3 fields · ice · ELM327 v1.5")
    expect(obdProfileSummary(null)).toBeNull()
  })
})

describe("obdStatusDisplay", () => {
  it("names the states the bench walked through", () => {
    const at = (status: string) => obdStatusDisplay(reportedObd(deviceWith({ obd: { status, link: 0 } })))
    expect(at("backoff")).toMatchObject({ label: "Adapter not found", tone: "danger" })
    expect(at("adapter_not_found").label).toBe("Adapter not found")
    expect(at("disabled")).toMatchObject({ label: "Polling off", tone: "muted" })
    expect(at("not_configured").tone).toBe("muted")
    expect(at("connecting")).toMatchObject({ label: "Connecting", hint: null })
    expect(at("live")).toMatchObject({ label: "Reading the bus", tone: "ok" })
    expect(at("ecu_silent").tone).toBe("warn")
    expect(at("parked").tone).toBe("danger")
  })
})

describe("scan helpers", () => {
  const scan = { ts: 1_000, candidates: [], error: null }
  it("recognises a scan by timestamp, or by moving past the previous one", () => {
    expect(isScanAfter(null, 500, null)).toBe(false)
    expect(isScanAfter(scan, 500, null)).toBe(true)
    // Device clock behind the browser's: ts < requestedAt, but it moved.
    expect(isScanAfter(scan, 5_000, 900)).toBe(true)
    expect(isScanAfter(scan, 5_000, 1_000)).toBe(false)
    expect(isScanAfter(scan, 5_000, null)).toBe(false)
  })
  it("blocks a scan offline and inside the server's 60 s window", () => {
    const now = Date.parse("2026-10-13T12:00:00Z")
    expect(obdScanBlocker({ status: "offline", obdScanRequestedAt: null }, now)).toMatch(/offline/)
    expect(obdScanBlocker({ status: "online", obdScanRequestedAt: null }, now)).toBeNull()
    expect(obdScanBlocker({ status: "online", obdScanRequestedAt: "2026-10-13T11:59:30Z" }, now)).toBe(
      "Another scan is allowed in 30 s."
    )
    expect(obdScanBlocker({ status: "online", obdScanRequestedAt: "2026-10-13T11:58:00Z" }, now)).toBeNull()
  })
})
