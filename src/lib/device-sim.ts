// The SIM in a device, as the device itself reports it
// (manage_sim_card_info_in_settings, Phase 1).
//
// READ-ONLY, and deliberately not a config namespace. You cannot *set* an
// ICCID, so there is no desired value to compare against and a
// `ConfigStatusBadge` here could only ever read "in force". It rides
// `reportedConfig.effective.sim` exactly like `agent.mode` does — see
// `reportedAgentMode` in device-config-status.ts for the same shape.
//
// The state this module exists for is `not-detected`. On 2026-08-08 a device
// with an intermittent SIM socket showed as "online, no LTE" while the only
// device-side clue was "good signal, not registered" — which points at
// coverage. AT+CSQ reports a signal WITH NO SIM PRESENT, so it was meaningless.
// A day of investigation. "No SIM detected" has to be impossible to mistake for
// "no signal", and — just as important — an old agent that reports nothing at
// all has to render as UNKNOWN rather than as "no SIM".

import type { Device } from "./api"
import { parseReportedConfig } from "./device-config-status"

/** SIM presence/usability as the modem reported it. */
export type SimState = "ready" | "locked" | "not-detected" | "error" | "unknown"

/** 3GPP registration, resolved to a label by the device daemon. */
export type SimRegistration =
  | "home"
  | "roaming"
  | "searching"
  | "denied"
  | "not-searching"
  | "unknown"

/** The raw reported block, after a defensive parse. */
export interface ReportedSim {
  present: 0 | 1 | null
  state: SimState
  iccid?: string
  msisdn?: string
  carrier?: string
  act?: string
  registration?: SimRegistration
  checkedAt?: string
}

/** Which interface carries the default route (Phase 2 scales its UI off this). */
export interface ReportedUplink {
  primary: string | null
  modemOnly: boolean
}

/**
 * What the card actually shows. Wider than `SimState` because registration
 * splits a present SIM into cases with completely different remedies:
 * `denied` sends you to the carrier account, `searching` to the antenna.
 */
export type SimDisplayState =
  | "active"
  | "denied"
  | "searching"
  | "present"
  | "not-detected"
  | "locked"
  | "error"
  | "unknown"

export interface SimDisplay {
  state: SimDisplayState
  /** The headline beside "Status". */
  label: string
  /** One sentence naming what to do, or null when there is nothing to do. */
  hint: string | null
  /** How loudly to render it. */
  tone: "ok" | "warn" | "danger" | "muted"
}

const SIM_STATES: readonly SimState[] = ["ready", "locked", "not-detected", "error", "unknown"]
const SIM_REGISTRATIONS: readonly SimRegistration[] = [
  "home",
  "roaming",
  "searching",
  "denied",
  "not-searching",
  "unknown",
]

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined

/**
 * Read the reported SIM block off a device. `null` means "this device has told
 * us nothing" — an agent predating this feature, a device that has never
 * connected, or a daemon whose telemetry was unreadable when the report was
 * built. It does NOT mean there is no SIM, and callers must not render it as
 * one.
 *
 * Defensive throughout: this is device-authored JSON that arrives through an
 * MQTT rule rather than through our own API.
 */
export function reportedSim(device: Device | null | undefined): ReportedSim | null {
  const raw = parseReportedConfig(device?.reportedConfig)?.effective.sim
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const src = raw as Record<string, unknown>
  if (!SIM_STATES.includes(src.state as SimState)) return null
  const out: ReportedSim = {
    state: src.state as SimState,
    present: src.present === 1 ? 1 : src.present === 0 ? 0 : null,
  }
  const iccid = str(src.iccid)
  if (iccid !== undefined) out.iccid = iccid
  // Absent is the NORMAL case: many carriers never write EF_MSISDN, so the row
  // must disappear rather than render a permanent blank that reads as a fault.
  const msisdn = str(src.msisdn)
  if (msisdn !== undefined) out.msisdn = msisdn
  const carrier = str(src.carrier)
  if (carrier !== undefined) out.carrier = carrier
  const act = str(src.act)
  if (act !== undefined) out.act = act
  if (SIM_REGISTRATIONS.includes(src.registration as SimRegistration)) {
    out.registration = src.registration as SimRegistration
  }
  const checkedAt = str(src.checked_at)
  if (checkedAt !== undefined) out.checkedAt = checkedAt
  return out
}

/** Read the reported uplink block, or null when the device has not sent one. */
export function reportedUplink(device: Device | null | undefined): ReportedUplink | null {
  const raw = parseReportedConfig(device?.reportedConfig)?.effective.uplink
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const src = raw as Record<string, unknown>
  return {
    primary: str(src.primary) ?? null,
    modemOnly: src.modem_only === 1,
  }
}

/**
 * The headline. Every branch was reachable on real hardware; `not-detected` is
 * the one the whole phase exists for, and `unknown` must never be confused
 * with it.
 */
export function simDisplay(sim: ReportedSim | null): SimDisplay {
  if (sim === null) {
    return {
      state: "unknown",
      label: "Unknown",
      hint: "This device has not reported its SIM yet. Older agents never do.",
      tone: "muted",
    }
  }
  switch (sim.state) {
    case "not-detected":
      return {
        state: "not-detected",
        label: "No SIM detected",
        hint: "The modem reports no card in the slot. Check the SIM is seated.",
        tone: "danger",
      }
    case "locked":
      return {
        state: "locked",
        label: "SIM locked",
        hint: "The card is asking for a PIN or PUK. It has to be unlocked on other hardware.",
        tone: "danger",
      }
    case "error":
      return {
        state: "error",
        label: "SIM error",
        hint: "A card is in the slot but the modem cannot read it. Reseat or replace it.",
        tone: "danger",
      }
    case "unknown":
      return {
        state: "unknown",
        label: "Unknown",
        hint: "The modem did not answer. This is not the same as having no SIM.",
        tone: "muted",
      }
    case "ready":
      break
  }
  switch (sim.registration) {
    case "home":
    case "roaming":
      return {
        state: "active",
        label: sim.registration === "roaming" ? "Active (roaming)" : "Active",
        hint: null,
        tone: "ok",
      }
    case "denied":
      // The network actively REJECTED this card — a deprovisioned or unpaid
      // account. Nothing else in the product tells this apart from no coverage.
      return {
        state: "denied",
        label: "Rejected by the network",
        hint: "The carrier refused this SIM. Check the account is active and the plan covers data.",
        tone: "danger",
      }
    case "searching":
    case "not-searching":
      return {
        state: "searching",
        label: "Searching for network",
        hint: "The SIM is fine; the device is not attached yet. Check the antenna and coverage.",
        tone: "warn",
      }
    default:
      return {
        state: "present",
        label: "SIM present",
        hint: "The card is readable but the device has not reported its registration.",
        tone: "muted",
      }
  }
}

/** "Public Mobile · LTE", or just the carrier, or null. */
export function simCarrierLabel(sim: ReportedSim | null): string | null {
  if (sim === null || sim.carrier === undefined) return null
  const act = sim.act === undefined ? null : sim.act.toUpperCase()
  return act === null ? sim.carrier : `${sim.carrier} · ${act}`
}

/**
 * `8912230000507537488` -> `•••• •••• •••• 7488`.
 *
 * Masked by default because an ICCID identifies a subscriber, not just a piece
 * of hardware (README §6) — but the last four are what an operator matches
 * against the number printed on the card, so they stay visible.
 */
export function maskIccid(iccid: string): string {
  const tail = iccid.slice(-4)
  return `•••• •••• •••• ${tail}`
}

/** `8912230000507537488` -> `8912 2300 0050 7537 488`, for the revealed value. */
export function groupIccid(iccid: string): string {
  return (iccid.match(/.{1,4}/g) ?? [iccid]).join(" ")
}

/**
 * `+14379073824` -> `+1 437-907-3824`. Anything that is not a NANP number is
 * returned untouched rather than mangled into a shape it does not have.
 */
export function formatMsisdn(msisdn: string): string {
  const nanp = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(msisdn)
  if (nanp !== null) return `+1 ${nanp[1]}-${nanp[2]}-${nanp[3]}`
  return msisdn
}
