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

import type { Device } from "@xorgate/sdk"
import type { SettingsTab } from "./device-settings-tabs"
import { CONFIG_NAMESPACE_DEFAULTS } from "./device-config-defaults"
import { deepEqual } from "./deep-equal"

/** Namespaces of the device-delivered config document, in registry order. */
export const CONFIG_NAMESPACES = [
  "gnssAntBias",
  "imuMount",
  "recording",
  "lteRecovery",
  "timeSync",
  "cellular",
  "cameraMount",
  // Simulated devices only (plans/xorgate-device-simulator). A real device
  // never holds it: the cloud refuses it there and never publishes it, so it
  // resolves to `unset` and contributes no attention badge.
  "simulation",
  // OBD-II adapter (plans/obd2-bluetooth-integration). Accepted only
  // for a model declaring `peripherals.obd`; elsewhere the cloud never holds
  // it, so it resolves to `unset` like `simulation` on a real device.
  "obd",
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
  /**
   * The cloud manages nothing here, but the device is NOT on its defaults —
   * so this page is showing defaults the device is not running, and neither
   * side has said anything is wrong (settings_sync_hardening, finding 2).
   *
   * COMPUTED here, like `pending` and unlike every other state: the device
   * cannot report a verdict on a namespace the cloud never sent it, and that
   * silence is precisely the problem.
   */
  | "diverged"

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
  // `unknown`, not the SDK's DeviceReportedConfig: this parser is the app's
  // own defensive narrowing (older agents send sparser shapes), so it accepts
  // whatever the row carried and validates for itself.
  raw: unknown
): ReportedConfig | null {
  if (!raw || typeof raw !== "object") return null
  const rec = raw as Record<string, unknown>
  const rev = rec.rev
  const status: ReportedConfig["status"] = {}
  const rawStatus = rec.status
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
    rec.effective && typeof rec.effective === "object" && !Array.isArray(rec.effective)
      ? (rec.effective as Record<string, unknown>)
      : {}
  return {
    ts: typeof rec.ts === "number" ? rec.ts : null,
    rev: typeof rev === "number" && Number.isFinite(rev) && rev > 0 ? Math.floor(rev) : 0,
    origin: typeof rec.origin === "string" ? rec.origin : null,
    effective,
    status,
  }
}

/**
 * The run mode the device says it is in (`sim` / `real`), or null when it has
 * never reported one (an older agent, or a device that has never connected).
 *
 * Reported-only by design (design.md §3, Q4): a device in `sim` publishes
 * synthetic data, so an operator needs to SEE it — but flipping a fielded
 * device into sim from the cloud would silently replace real data with
 * simulated data, so there is deliberately no cloud-writable counterpart and no
 * per-namespace verdict for it.
 */
export function reportedAgentMode(device: Device | null): string | null {
  const reported = parseReportedConfig(device?.reportedConfig)
  const agent = reported?.effective.agent
  if (!agent || typeof agent !== "object") return null
  const mode = (agent as Record<string, unknown>).mode
  return typeof mode === "string" && mode.length > 0 ? mode : null
}

/** The agent build a device says it is running (device_update_management). */
export interface ReportedAgentBuild {
  /** CI short sha (dev), release tag (prod), or the package version locally. */
  version: string
  /** "dev" | "prod" from CI, "bench"/"local" for a hand-deployed tree. */
  channel: string | null
  builtAt: string | null
  packageVersion: string | null
}

/**
 * Parse `reportedConfig.effective.agent.build`, or null when the device has
 * never reported one (an agent older than the build manifest, or a device that
 * has never connected).
 *
 * Reported-only, like [reportedAgentMode] — there is no cloud-writable
 * counterpart, and the cloud's `device.agentVersion` is a mirror of this very
 * value, kept as the fallback for a row whose report has aged out. Defensive
 * because `effective` is an opaque device-authored document: only `version`
 * must be a non-empty string; everything else degrades to null.
 */
export function reportedAgentBuild(device: Device | null): ReportedAgentBuild | null {
  const reported = parseReportedConfig(device?.reportedConfig)
  const agent = reported?.effective.agent
  if (!isPlainObject(agent)) return null
  const build = agent.build
  if (!isPlainObject(build)) return null
  const version = typeof build.version === "string" ? build.version.trim() : ""
  if (version.length === 0) return null
  return {
    version,
    channel: optionalString(build.channel),
    builtAt: optionalString(build.builtAt),
    packageVersion: optionalString(build.packageVersion),
  }
}

const optionalString = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * Resolve a stored namespace over its defaults: a key the device does not hold
 * takes the default's value, recursively. Non-objects replace whole.
 */
function resolveOverDefaults(defaults: unknown, value: unknown): unknown {
  if (!isPlainObject(defaults) || !isPlainObject(value)) return value
  const out: Record<string, unknown> = { ...defaults }
  for (const [k, v] of Object.entries(value)) {
    out[k] = k in defaults ? resolveOverDefaults(defaults[k], v) : v
  }
  return out
}

/**
 * Is the device holding something other than this namespace's shipped default?
 *
 * Defaults come from the committed contract artifact (via
 * `device-config-defaults`), never a hand-copy — that drift is what the
 * registry exists to stop.
 *
 * Two things this is deliberately NOT:
 *
 * - not `JSON.stringify` equality. The device re-serializes settings.json in
 *   its own key order, so identical documents stringify differently.
 * - not a bare deep-equal against the defaults. `effective` is the RAW stored
 *   namespace, not a resolved one, so a namespace the device holds only part
 *   of (an older agent, a targeted `xorgate set`) would read as divergence
 *   while every key it does hold matches. Resolving it over the defaults first
 *   applies the same absent-means-defaults convention both sides already use,
 *   and asks the honest question: does anything the device holds actually move
 *   a value off its default?
 *
 * `undefined` — the device holds no value at all — is agreement by that same
 * convention, not divergence.
 */
function divergesFromDefaults(ns: ConfigNamespace, effective: unknown): boolean {
  if (effective === undefined) return false
  const defaults = CONFIG_NAMESPACE_DEFAULTS[ns]
  // A namespace this build's contract artifact does not know: say nothing
  // rather than badge a device over an artifact we cannot compare against.
  if (defaults === undefined) return false
  return !deepEqual(resolveOverDefaults(defaults, effective), defaults)
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
      // `simulation` exists only for devices created as simulated: the cloud
      // refuses it for real hardware and never publishes it there. Without
      // this, a real device's unrelated pending save would mark it "pending"
      // too and badge the General tab for a card that tab never shows.
      if (ns === "simulation" && !device.simulated) {
        return [ns, { state: "unset", effective }]
      }
      // `obd` exists only for a model declaring `peripherals.obd`: the cloud
      // refuses it elsewhere, and the agent reports an `effective.obd` block
      // only when its hardware block carries the peripheral. A device holding
      // neither has nothing to say about it, so an unrelated pending save must
      // not badge the Peripherals tab of (say) an excavator.
      if (ns === "obd" && effective === undefined && config.obd == null) {
        return [ns, { state: "unset", effective }]
      }
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
      // which means the cloud never sent it — and that is ALL it means. It
      // does not mean the device is on its defaults, which is what this branch
      // used to assume. `PATCH {ns: null}` deletes the key cloud-side, so the
      // namespace stops being published; an omitted namespace has always meant
      // "leave the local value alone", so the device keeps what it had and
      // never issues a verdict on it either. Result before this check: the
      // page showed defaults with no badge while the device ran something
      // else (settings_sync_hardening, finding 2 / phase-6 scenario B11b).
      //
      // `!= null` rather than `ns in config`: a namespace stored as an
      // explicit cleared marker reads as "the cloud manages nothing here",
      // exactly like an absent one.
      if (config[ns] != null) return [ns, { state: "applied", effective }]
      return [
        ns,
        { state: divergesFromDefaults(ns, effective) ? "diverged" : "unset", effective },
      ]
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
  cellular: ["connectivity"],
  cameraMount: ["media"],
  // Read-only Simulation card on General; switched from the reboot dialog.
  simulation: ["general"],
  obd: ["peripherals"],
}

/**
 * States worth pulling an operator's eye to a tab they are not looking at.
 *
 * `adjusted` is excluded on purpose (settings plan, Phase 3): clamping is
 * normal, permanent, and already visible on the card itself, so counting it
 * would put a badge on a tab forever.
 *
 * `diverged` IS counted, and the reason is the exact inverse of that argument:
 * the card shows the DEFAULTS confidently, so there is nothing on it to catch
 * the eye, and without a count nobody has a reason to open the tab at all. It
 * is also rare and always actionable — save the card and the two sides
 * converge.
 */
const ATTENTION_STATES: ReadonlySet<ConfigState> = new Set<ConfigState>([
  "pending",
  "queued",
  "rejected",
  "diverged",
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
  applied: "Synced",
  adjusted: "Adjusted",
  rejected: "Rejected",
  unset: "",
  // Not "unset". An operator has to be able to act on this, and the thing to
  // act on is that the device and this page disagree.
  diverged: "Device differs",
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
    case "diverged":
      return (
        "Nothing is saved here, so this card is showing the defaults — but the device " +
        "reports it is running a different value. Save this card to bring the device in line."
      )
    default:
      return null
  }
}
