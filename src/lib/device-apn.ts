// The device's APN, as the modem daemon reports its own apply machinery
// (manage_sim_card_info_in_settings, Phase 2).
//
// Two planes meet on the APN card and this module keeps them straight:
//
//  - the `cellular` NAMESPACE (desired + status) — what an operator asked for,
//    and the device's verdict on it. That half renders through the standard
//    ConfigStatusBadge / ConfigStatusCallout like every sibling namespace.
//  - the reported-only `effective.apn` block — what the modem's data context
//    ACTUALLY holds and what the apply machinery last did. This is the half
//    that makes a rollback visible, feeds the input's placeholder, and — most
//    important — gates the save: a device whose daemon reports NO apn block
//    has no confirm-and-rollback safety net, and writing an APN to it can
//    strand it permanently. That absence must hard-block the save.
//
// All decisions live here, DOM-free, because the frontend vitest has no DOM;
// the card component is a thin renderer over these functions.

import type { Device } from "./api"
import { parseReportedConfig } from "./device-config-status"
import { reportedUplink, type ReportedUplink } from "./device-sim"

export type ApnMachineState = "in-force" | "applying" | "rolled-back" | "rejected"

/** The reported-only `effective.apn` block, defensively parsed. */
export interface ReportedApn {
  state: ApnMachineState
  /** The APN in the modem's data context (NV truth). */
  applied?: string
  /** The last non-empty value the device was asked to apply. */
  requested?: string
  lastError?: string
  fails?: number
  changedAt?: string
}

const APN_STATES: readonly ApnMachineState[] = [
  "in-force",
  "applying",
  "rolled-back",
  "rejected",
]

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined

/**
 * Read the reported APN machinery off a device. `null` means the device has
 * never reported it — an agent/daemon predating Phase 2, or one that has not
 * spoken since booting. Callers MUST treat null as "no rollback net", never as
 * "no APN".
 */
export function reportedApn(device: Device | null | undefined): ReportedApn | null {
  const raw = parseReportedConfig(device?.reportedConfig)?.effective.apn
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const src = raw as Record<string, unknown>
  if (!APN_STATES.includes(src.state as ApnMachineState)) return null
  const out: ReportedApn = { state: src.state as ApnMachineState }
  const applied = str(src.apn_applied)
  if (applied !== undefined) out.applied = applied
  const requested = str(src.apn_requested)
  if (requested !== undefined) out.requested = requested
  const lastError = str(src.last_error)
  if (lastError !== undefined) out.lastError = lastError
  if (typeof src.fails === "number" && Number.isFinite(src.fails) && src.fails >= 0) {
    out.fails = Math.floor(src.fails)
  }
  const changedAt = str(src.changed_at)
  if (changedAt !== undefined) out.changedAt = changedAt
  return out
}

/** Client-side mirror of the wire constraint (backend registry + device). */
export const APN_INPUT_RE = /^[A-Za-z0-9.-]{0,100}$/

/**
 * How much friction a save gets (README §9, settled): scale it to the risk.
 *
 *  - `blocked` — the device reports NO apn machinery: there is no rollback
 *    safety net at all, so the UI must refuse outright. Showing the danger
 *    dialog there would be a lie ("it will restore itself" — it will not).
 *  - `danger`  — the modem is the device's ONLY uplink (or the uplink is
 *    unknown, which fails safe to the same treatment): a wrong APN makes the
 *    device unreachable until its own rollback lands. Typed confirmation.
 *  - `confirm` — a second link exists; cellular can break without losing the
 *    device. Plain confirmation.
 */
export type ApnSaveGate =
  | { kind: "blocked"; reason: string }
  | { kind: "danger"; message: string }
  | { kind: "confirm"; message: string }

export function apnSaveGate(
  apn: ReportedApn | null,
  uplink: ReportedUplink | null,
): ApnSaveGate {
  if (apn === null) {
    return {
      kind: "blocked",
      reason:
        "This device has not reported its APN safety machinery, so a wrong APN could " +
        "strand it permanently with no way to recover remotely. Update the device agent " +
        "before changing the APN from here.",
    }
  }
  if (uplink === null || uplink.modemOnly) {
    return {
      kind: "danger",
      message:
        uplink === null
          ? "This device has not reported whether it has another network connection — " +
            "assume cellular is its only link."
          : "This device is reachable only over cellular.",
    }
  }
  return {
    kind: "confirm",
    message:
      "This device also has a non-cellular connection, so it stays reachable while " +
      "the change applies.",
  }
}

/**
 * The card's one-line summary of what the machinery last did. Null when there
 * is nothing worth a callout (in force, nothing requested) — the badge and the
 * status callout already cover the ordinary states.
 */
export interface ApnMachineNote {
  text: string
  tone: "warn" | "danger"
}

export function apnMachineNote(apn: ReportedApn | null): ApnMachineNote | null {
  if (apn === null) return null
  switch (apn.state) {
    case "applying":
      return {
        tone: "warn",
        text: `Applying "${apn.requested ?? "a new APN"}" — the device is confirming it can pass real traffic. Cellular may drop for a few minutes.`,
      }
    case "rolled-back":
      return {
        tone: "danger",
        text:
          `The device tried "${apn.requested ?? "the requested APN"}", could not pass any data, and ` +
          `restored "${apn.applied ?? "the previous APN"}" on its own` +
          `${apn.lastError ? ` (${apn.lastError})` : ""}.`,
      }
    case "rejected":
      return {
        tone: "danger",
        text:
          `The device gave up on "${apn.requested ?? "the requested APN"}" after ` +
          `${apn.fails ?? "several"} failed attempts` +
          `${apn.lastError ? ` (${apn.lastError})` : ""}. Save a different value to try again.`,
      }
    default:
      return null
  }
}

/**
 * Validate the input before it goes anywhere near the API. Returns an error
 * sentence, or null when the value is fine (empty included — empty means
 * "leave the modem's stored APN alone").
 */
export function apnInputError(value: string): string | null {
  if (APN_INPUT_RE.test(value)) return null
  if (value.length > 100) return "An APN is at most 100 characters."
  return "Only letters, digits, dots and hyphens are allowed in an APN."
}

/** Re-exported so the card needs a single import for its gate inputs. */
export { reportedUplink }
