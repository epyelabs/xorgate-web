// Desired vs reported config (improve_device_settings_management, Phase 3).
//
// Every device setting has two truths: what the cloud stored (`config`, with
// its monotonic `configRev`) and what the device says it actually holds
// (`reportedConfig`, carrying the last `rev` it applied). Until Phase 3 the UI
// only ever knew the first, so "Settings saved" was the strongest thing it
// could honestly say. This module turns the pair into a per-namespace verdict.
//
// `pending` is COMPUTED here, never reported: the device has no way to know
// about a revision it has not received. Everything else comes straight off the
// device's own report.

import type { Device } from "./api"
import type { SettingsTab } from "./device-settings-tabs"

/** Namespaces of the device-delivered config document, in registry order. */
export const CONFIG_NAMESPACES = [
  "gnssAntBias",
  "imuMount",
  "recording",
  "lteRecovery",
  "timeSync",
] as const

export type ConfigNamespace = (typeof CONFIG_NAMESPACES)[number]

export type ConfigState =
  /** The device has never reported — a pre-Phase-3 agent, or never connected. */
  | "no-report"
  /** Saved and published; the device is online but has not echoed it back yet. */
  | "pending"
  /** Saved; the device is offline and will pick it up when it reconnects. */
  | "queued"
  /** The device confirms it holds exactly what was asked for. */
  | "applied"
  /** The device holds something else — clamped, normalized, or changed locally. */
  | "adjusted"
  /** The device could not use the delivered value at all. */
  | "rejected"
  /** The cloud manages nothing here; the device is on its own defaults. */
  | "unset"

export interface NamespaceStatus {
  state: ConfigState
  /** Why an `adjusted` value differs from what was asked for. */
  detail?: string
  /** Why a namespace was `rejected`. */
  reason?: string
  /**
   * The value the device says is in force. `undefined` means "device
   * defaults" — the same absent-means-defaults convention the desired document
   * uses, so a caller resolves both through the same defaults.
   */
  effective?: unknown
  /** Epoch ms the device determined this verdict. */
  at?: number
}

export type DeviceConfigStatus = Record<ConfigNamespace, NamespaceStatus>

const REPORTED_STATES = ["applied", "adjusted", "rejected"] as const

export interface ReportedConfig {
  ts: number | null
  /** Last desired revision the device applied. 0 = it has never received one. */
  rev: number
  origin: string | null
  effective: Record<string, unknown>
  status: Record<string, { state: ConfigState; at?: number; detail?: string; reason?: string }>
}

/**
 * Read the stored report defensively. It is device-authored JSON that arrives
 * through an MQTT rule rather than through our own API, and an agent older or
 * newer than this build may write a shape we do not fully know — so anything
 * unrecognized is dropped rather than allowed to throw in a render.
 */
export function parseReportedConfig(
  raw: Record<string, unknown> | null | undefined
): ReportedConfig | null {
  if (!raw || typeof raw !== "object") return null
  const rev = raw.rev
  const status: ReportedConfig["status"] = {}
  const rawStatus = raw.status
  if (rawStatus && typeof rawStatus === "object" && !Array.isArray(rawStatus)) {
    for (const [ns, value] of Object.entries(rawStatus as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue
      const entry = value as Record<string, unknown>
      const state = entry.state
      if (!REPORTED_STATES.includes(state as (typeof REPORTED_STATES)[number])) continue
      status[ns] = {
        state: state as ConfigState,
        at: typeof entry.at === "number" ? entry.at : undefined,
        detail: typeof entry.detail === "string" ? entry.detail : undefined,
        reason: typeof entry.reason === "string" ? entry.reason : undefined,
      }
    }
  }
  const effective =
    raw.effective && typeof raw.effective === "object" && !Array.isArray(raw.effective)
      ? (raw.effective as Record<string, unknown>)
      : {}
  return {
    ts: typeof raw.ts === "number" ? raw.ts : null,
    rev: typeof rev === "number" && Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : 0,
    origin: typeof raw.origin === "string" ? raw.origin : null,
    effective,
    status,
  }
}

function emptyStatus(state: ConfigState): DeviceConfigStatus {
  return Object.fromEntries(
    CONFIG_NAMESPACES.map((ns) => [ns, { state }])
  ) as DeviceConfigStatus
}

/**
 * The per-namespace verdict for a device.
 *
 * Precedence matters: a revision the device has not reached outranks whatever
 * it said about the PREVIOUS revision. Showing "applied" next to a control the
 * operator just changed — because the report still describes the old value —
 * is the exact lie this whole plane exists to stop telling.
 */
export function computeConfigStatus(device: Device | null): DeviceConfigStatus {
  if (device === null) return emptyStatus("no-report")
  const reported = parseReportedConfig(device.reportedConfig)
  if (reported === null) return emptyStatus("no-report")

  const behind = device.configRev > reported.rev
  const config = (device.config ?? {}) as Record<string, unknown>

  return Object.fromEntries(
    CONFIG_NAMESPACES.map((ns): [ConfigNamespace, NamespaceStatus] => {
      const effective = reported.effective[ns]
      if (behind) {
        // Offline is not a failure — the retained message is waiting for the
        // device, which converges on its next connect without anyone re-saving.
        return [ns, { state: device.status === "online" ? "pending" : "queued", effective }]
      }
      const entry = reported.status[ns]
      if (entry) {
        return [
          ns,
          { state: entry.state, detail: entry.detail, reason: entry.reason, at: entry.at, effective },
        ]
      }
      // The device is level with us and said nothing about this namespace,
      // which means the cloud never sent it: the device is on its defaults.
      return [ns, { state: ns in config ? "applied" : "unset", effective }]
    })
  ) as DeviceConfigStatus
}

/**
 * Which sub-tabs surface a namespace. `recording` spans four of them — the
 * document namespaces are wire names and deliberately NOT the UI grouping
 * (design.md §2), so one rejected namespace legitimately flags every tab that
 * edits part of it.
 */
export const NAMESPACE_TABS: Record<ConfigNamespace, readonly SettingsTab[]> = {
  gnssAntBias: ["connectivity"],
  imuMount: ["telemetry"],
  recording: ["telemetry", "media", "power", "system"],
  lteRecovery: ["connectivity"],
  timeSync: ["system"],
}

/** States worth pulling an operator's eye to a tab they are not looking at. */
const ATTENTION_STATES: ReadonlySet<ConfigState> = new Set<ConfigState>([
  "pending",
  "queued",
  "rejected",
])

/** Per-tab count of namespaces needing attention, for the tab trigger badges. */
export function tabAttentionCounts(
  status: DeviceConfigStatus
): Partial<Record<SettingsTab, number>> {
  const counts: Partial<Record<SettingsTab, number>> = {}
  for (const ns of CONFIG_NAMESPACES) {
    if (!ATTENTION_STATES.has(status[ns].state)) continue
    for (const tab of NAMESPACE_TABS[ns]) {
      counts[tab] = (counts[tab] ?? 0) + 1
    }
  }
  return counts
}

/** True while anything is still in flight — the cue to keep re-fetching. */
export function hasPending(status: DeviceConfigStatus): boolean {
  return CONFIG_NAMESPACES.some((ns) => status[ns].state === "pending")
}

/** Short label for the badge beside a card title. */
export const CONFIG_STATE_LABELS: Record<ConfigState, string> = {
  "no-report": "No report yet",
  pending: "Applying…",
  queued: "Waiting for device",
  applied: "In force",
  adjusted: "Adjusted",
  rejected: "Rejected",
  unset: "",
}

/**
 * The sentence under a card when the device disagrees, is out of reach, or has
 * never spoken. `applied` and `unset` say nothing — a settings page that
 * explains itself on every card explains nothing.
 */
export function configStateExplanation(status: NamespaceStatus): string | null {
  switch (status.state) {
    case "no-report":
      return (
        "This device has not reported what it is running yet. Settings saved here are " +
        "stored and delivered when it next connects."
      )
    case "pending":
      return "Saved and sent — waiting for the device to confirm it applied it."
    case "queued":
      return "Saved. The device is offline; it will pick this up when it reconnects."
    case "adjusted":
      return (
        status.detail ?? "The device is running a different value than the one saved here."
      )
    case "rejected":
      return status.reason ?? "The device could not use the value saved here."
    default:
      return null
  }
}
