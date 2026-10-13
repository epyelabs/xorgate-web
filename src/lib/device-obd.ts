// The vehicle OBD-II adapter, both halves (obd2-bluetooth-integration P3).
//
// Two planes meet on the Vehicle settings tab, the same split the APN card
// keeps for cellular:
//
//  - the `obd` NAMESPACE (desired + status): what an operator asked for
//    (adapter MAC, PIN, poll rate, fields, power source, the polling kill
//    switch) and the device's verdict on it. That half renders through the
//    standard ConfigStatusBadge / ConfigStatusCallout like every sibling.
//  - the reported-only runtime state under `effective.obd`: the collector's
//    status word, the link code, where the settings came from, the probed
//    vehicle profile, the audit counters and the last scan's candidates.
//
// All decisions live here, DOM-free, because the frontend vitest has no DOM;
// the cards are thin renderers over these functions.

import type { Device, IoCapabilities, ObdConfig, ObdPeripheralCapability } from "@xorgate/sdk"
import contract from "@/lib/config-contract.json"
import { parseReportedConfig } from "./device-config-status"

/** A declared OBD field name, as the model and the namespace spell it. */
export type ObdFieldName = NonNullable<ObdConfig["fields"]>[number]

/**
 * The model's OBD-II declaration, or null for a model without one. Only a v2
 * capabilities document can carry `peripherals`; a v1 document declares no
 * vehicle at all, so the Vehicle tab explains itself instead of rendering
 * controls the API would refuse (400 on the `obd` namespace).
 */
export function obdCapability(caps: IoCapabilities | null | undefined): ObdPeripheralCapability | null {
  if (!caps || caps.schemaVersion !== 2) return null
  return caps.peripherals?.obd ?? null
}

// ---- the namespace ---------------------------------------------------------

const OBD_DEFAULTS = contract.namespaces.obd.defaults

export type ObdPowerSource = NonNullable<ObdConfig["powerSource"]>

/** The namespace resolved over the device defaults: every control has a value. */
export interface ResolvedObd {
  enabled: boolean
  adapterMac: string | null
  pin: string
  pollHz: number
  /** Empty = every field the model declares (the contract's default). */
  fields: ObdFieldName[]
  powerSource: ObdPowerSource
}

/**
 * Resolve the stored namespace over the contract defaults, the same
 * absent-means-default convention the device applies. `null` (nothing stored)
 * is the pristine default document.
 */
export function resolveObd(cfg: ObdConfig | null | undefined): ResolvedObd {
  return {
    enabled: cfg?.enabled ?? OBD_DEFAULTS.enabled,
    adapterMac: cfg?.adapterMac === undefined ? OBD_DEFAULTS.adapterMac : cfg.adapterMac,
    pin: cfg?.pin ?? OBD_DEFAULTS.pin,
    pollHz: cfg?.pollHz ?? OBD_DEFAULTS.pollHz,
    fields: cfg?.fields ?? (OBD_DEFAULTS.fields as ObdFieldName[]),
    powerSource: (cfg?.powerSource ?? OBD_DEFAULTS.powerSource) as ObdPowerSource,
  }
}

/**
 * A save always sends the complete namespace: the backend replaces `obd`
 * WHOLE on write (contract), so a partial patch would reset every field it
 * omits to the device default.
 */
export function buildObdConfig(r: ResolvedObd): ObdConfig {
  return {
    enabled: r.enabled,
    adapterMac: r.adapterMac,
    pin: r.pin,
    pollHz: r.pollHz,
    fields: r.fields,
    powerSource: r.powerSource,
  }
}

/**
 * What "Forget adapter" writes after the device command: polling off and no
 * adapter, with the rest of the namespace kept. The SDK's `obdForget` only
 * drops the bond on the device; without this the retained config re-pairs the
 * same adapter on its next settings poll.
 */
export function forgetObdConfig(current: ResolvedObd): ObdConfig {
  return buildObdConfig({ ...current, enabled: false, adapterMac: null })
}

/** Client-side mirror of the wire constraint (backend registry + device). */
export const OBD_MAC_RE = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/
export const OBD_PIN_RE = /^[0-9]{4,6}$/
/** The contract's `pollHz` bounds. */
export const OBD_POLL_HZ_MIN = 0.2
export const OBD_POLL_HZ_MAX = 2
/** The presets the rate select offers; a stored value off the list is added. */
export const OBD_POLL_HZ_OPTIONS = [0.2, 0.5, 1, 2]

/**
 * Normalize a typed MAC to the stored form: trimmed, `-` and `.` separators
 * accepted from a label, uppercase. Returns the input unchanged when it is
 * not a MAC at all, so the error message names what was typed.
 */
export function normalizeMac(value: string): string {
  const trimmed = value.trim().toUpperCase()
  const separated = trimmed.replace(/[-.\s]/g, ":")
  if (OBD_MAC_RE.test(separated)) return separated
  // 12 bare hex digits, as some labels print them.
  if (/^[0-9A-F]{12}$/.test(trimmed)) return (trimmed.match(/.{2}/g) ?? []).join(":")
  return trimmed
}

/**
 * Validate the adapter MAC before it goes anywhere near the API. Returns an
 * error sentence, or null when the value is fine (empty included — empty
 * means "no adapter", stored as `null`).
 */
export function macInputError(value: string): string | null {
  if (value.trim() === "") return null
  if (OBD_MAC_RE.test(normalizeMac(value))) return null
  return "A Bluetooth address is six pairs of hex digits, like 10:21:3E:4F:33:65."
}

/** Validate the pairing PIN: 4 to 6 digits, as the contract requires. */
export function pinInputError(value: string): string | null {
  if (OBD_PIN_RE.test(value)) return null
  return "A pairing PIN is 4 to 6 digits."
}

/**
 * Restrict a stored field list to what the model declares, in the model's
 * order. A field the model no longer declares (the device moved models, or
 * the catalog was edited) is dropped rather than shown as a phantom checkbox.
 */
export function selectedObdFields(
  stored: readonly ObdFieldName[],
  declared: readonly ObdFieldName[]
): ObdFieldName[] {
  return declared.filter((f) => stored.includes(f))
}

// ---- the report --------------------------------------------------------------

/** The collector's state word, as the agent's `effective.obd.status` spells it. */
export type ObdReportedState =
  | "disabled"
  | "not_configured"
  | "starting"
  | "retrying"
  | "parked"
  | "stopped"
  | "connecting"
  | "pairing"
  | "probing"
  | "live"
  | "ecu_silent"
  | "backoff"
  | "adapter_not_found"

const OBD_STATES: readonly ObdReportedState[] = [
  "disabled",
  "not_configured",
  "starting",
  "retrying",
  "parked",
  "stopped",
  "connecting",
  "pairing",
  "probing",
  "live",
  "ecu_silent",
  "backoff",
  "adapter_not_found",
]

/** 0 no adapter, 1 adapter answering, 2 vehicle answering. */
export type ObdLink = 0 | 1 | 2

export interface ObdScanCandidate {
  mac: string
  name: string | null
  /** dBm; null when discovery did not report one. */
  rssi: number | null
}

export interface ObdReportedScan {
  /** Epoch ms the scan finished, on the device clock. */
  ts: number
  candidates: ObdScanCandidate[]
  /** The scan helper's failure, when it had one (candidates then empty). */
  error: string | null
}

export interface ObdReportedProfile {
  protocol: string | null
  responders: string[]
  supportedFields: string[]
  unsupportedFields: string[]
  powertrain: string | null
  adapterId: string | null
}

export interface ObdReportedAudit {
  requests: number
  ok: number
  noData: number
  timeouts: number
  reconnects: number
  /** forbidden_attempts + budget_violations: helper bugs, never vehicle faults. */
  forbidden: number
  /** Distinct commands the helper has sent. */
  inventorySize: number
  lastStop: { ts: number | null; reason: string | null } | null
}

/** The reported-only `effective.obd` block, defensively parsed. */
export interface ReportedObd {
  status: ObdReportedState
  link: ObdLink
  source: "settings" | "env" | null
  /** The adapter the collector is actually using (resolved, not desired). */
  adapterMac: string | null
  enabled: boolean | null
  profile: ObdReportedProfile | null
  audit: ObdReportedAudit | null
  scan: ObdReportedScan | null
  helperVersion: string | null
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null)
const count = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []

function parseProfile(raw: unknown): ObdReportedProfile | null {
  if (!isPlainObject(raw)) return null
  const protocol = isPlainObject(raw.protocol) ? raw.protocol : {}
  const adapter = isPlainObject(raw.adapter) ? raw.adapter : {}
  return {
    protocol: str(protocol.dp) ?? str(protocol.dpn),
    responders: strList(raw.responders),
    supportedFields: strList(raw.supported_fields),
    unsupportedFields: strList(raw.unsupported_fields),
    powertrain: str(raw.powertrain),
    adapterId: str(adapter.ati),
  }
}

function parseAudit(raw: unknown): ObdReportedAudit | null {
  if (!isPlainObject(raw)) return null
  const c = isPlainObject(raw.counters) ? raw.counters : {}
  const stop = isPlainObject(raw.last_stop) ? raw.last_stop : null
  return {
    requests: count(c.requests),
    ok: count(c.ok),
    noData: count(c.no_data),
    timeouts: count(c.timeouts),
    reconnects: count(c.reconnects),
    forbidden: count(c.forbidden_attempts) + count(c.budget_violations),
    inventorySize: isPlainObject(raw.inventory) ? Object.keys(raw.inventory).length : 0,
    lastStop:
      stop === null
        ? null
        : {
            ts: typeof stop.ts === "number" && Number.isFinite(stop.ts) ? stop.ts : null,
            reason: str(stop.reason),
          },
  }
}

function parseScan(raw: unknown): ObdReportedScan | null {
  if (!isPlainObject(raw)) return null
  if (typeof raw.ts !== "number" || !Number.isFinite(raw.ts)) return null
  const candidates: ObdScanCandidate[] = []
  if (Array.isArray(raw.candidates)) {
    for (const entry of raw.candidates) {
      if (!isPlainObject(entry)) continue
      const mac = str(entry.mac)
      if (mac === null) continue
      candidates.push({
        mac: mac.toUpperCase(),
        name: str(entry.name),
        rssi: typeof entry.rssi === "number" && Number.isFinite(entry.rssi) ? entry.rssi : null,
      })
    }
  }
  return { ts: raw.ts, candidates, error: str(raw.error) }
}

/**
 * Read the collector's report off a device. `null` means the device has
 * never reported one: an agent predating the OBD collector, a model whose
 * hardware block declares no peripheral (the agent omits the block), or a
 * device that has never connected. Callers must not render null as "no
 * adapter".
 */
export function reportedObd(device: Device | null | undefined): ReportedObd | null {
  const raw = parseReportedConfig(device?.reportedConfig)?.effective.obd
  if (!isPlainObject(raw)) return null
  if (!OBD_STATES.includes(raw.status as ObdReportedState)) return null
  const link = raw.link === 1 || raw.link === 2 ? raw.link : 0
  const adapter = isPlainObject(raw.adapter) ? raw.adapter : {}
  return {
    status: raw.status as ObdReportedState,
    link,
    source: raw.source === "settings" || raw.source === "env" ? raw.source : null,
    adapterMac: (str(adapter.mac) ?? str(raw.adapterMac))?.toUpperCase() ?? null,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : null,
    profile: parseProfile(raw.profile),
    audit: parseAudit(raw.audit),
    scan: parseScan(raw.scan),
    helperVersion: str(raw.helper_version),
  }
}

export interface ObdStatusDisplay {
  /** The headline beside "Status". */
  label: string
  /** One sentence naming what to do, or null when there is nothing to do. */
  hint: string | null
  tone: "ok" | "warn" | "danger" | "muted"
}

/**
 * The headline for the report card. Every state the collector can report has
 * a plain-words label; the hint names what an operator can do about it, and
 * stays null while the state is simply "working".
 */
export function obdStatusDisplay(obd: ReportedObd | null): ObdStatusDisplay {
  if (obd === null) {
    return {
      label: "Unknown",
      hint: "This device has not reported its OBD adapter yet. Older agents never do.",
      tone: "muted",
    }
  }
  switch (obd.status) {
    case "disabled":
      return { label: "Polling off", hint: "OBD polling is switched off in the settings.", tone: "muted" }
    case "not_configured":
      return {
        label: "No adapter configured",
        hint: "Scan for the adapter or type its address from the label, then turn polling on.",
        tone: "muted",
      }
    case "starting":
    case "retrying":
    case "connecting":
      return { label: "Connecting", hint: null, tone: "warn" }
    case "pairing":
      return { label: "Pairing", hint: "Keep the adapter plugged in and powered while it pairs.", tone: "warn" }
    case "probing":
      return { label: "Probing the vehicle", hint: null, tone: "warn" }
    case "live":
      return { label: "Reading the vehicle", hint: null, tone: "ok" }
    case "ecu_silent":
      return {
        label: "Adapter only",
        hint: "The adapter answers but the vehicle does not. Ignition off, or a protocol the adapter cannot reach.",
        tone: "warn",
      }
    case "backoff":
    case "adapter_not_found":
      return {
        label: "Adapter not found",
        hint: "The adapter is unplugged, out of range or not powered. Check the dongle and the vehicle's socket.",
        tone: "danger",
      }
    case "parked":
      return {
        label: "Paused after repeated failures",
        hint: "The device stopped retrying for now. See the device events, then change the adapter or toggle polling to retry.",
        tone: "danger",
      }
    case "stopped":
      return { label: "Stopped", hint: null, tone: "muted" }
  }
}

/** The three link codes in words, matching the telemetry readout's labels. */
export const OBD_LINK_LABELS: Record<ObdLink, string> = {
  0: "No adapter",
  1: "Adapter only",
  2: "Vehicle answering",
}

/** "ISO 15765-4 (CAN 11/500) · ECUs 7E8,7E9 · 14/21 fields · ice", or null. */
export function obdProfileSummary(profile: ObdReportedProfile | null): string | null {
  if (profile === null) return null
  const total = profile.supportedFields.length + profile.unsupportedFields.length
  const parts = [
    profile.protocol ?? "protocol ?",
    `ECUs ${profile.responders.join(",") || "none"}`,
    `${profile.supportedFields.length}/${total} fields`,
    profile.powertrain ?? "unknown",
  ]
  if (profile.adapterId !== null) parts.push(profile.adapterId)
  return parts.join(" · ")
}

/**
 * Is this scan the answer to a request made at `requestedAt`? The device
 * stamps `ts` from its own clock, which the modem may never have set (a
 * NITZ-less SIM7600 serves 1980), so a fresh scan is also recognised by its
 * `ts` moving past the one the page saw before the request.
 */
export function isScanAfter(
  scan: ObdReportedScan | null,
  requestedAt: number,
  previousTs: number | null
): boolean {
  if (scan === null) return false
  if (scan.ts >= requestedAt) return true
  return previousTs !== null && scan.ts > previousTs
}

/**
 * The scan button's state in words. `null` = enabled. Mirrors the server's
 * gate (any member; online; 60 s between scans) so the button explains itself
 * instead of letting a click bounce.
 */
export function obdScanBlocker(
  device: Pick<Device, "status" | "obdScanRequestedAt">,
  now: number = Date.now()
): string | null {
  if (device.status !== "online") return "The device is offline."
  if (device.obdScanRequestedAt !== null) {
    const since = now - Date.parse(device.obdScanRequestedAt)
    if (Number.isFinite(since) && since >= 0 && since < 60_000) {
      return `Another scan is allowed in ${Math.ceil((60_000 - since) / 1000)} s.`
    }
  }
  return null
}
