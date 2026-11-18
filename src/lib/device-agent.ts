/**
 * Dual-agent registration, console side (device-agent-js-to-rust Phase 8,
 * D6): the pure rules the console applies on top of SDK 0.17.0.
 *
 * The SDK carries the data: `agent` on `create()`, on every registration and
 * on every `Device` (filled in as `js` when an old backend omits it), and
 * `devices.agentChannel()`. What stays here is policy:
 *
 * - the M1 echo guard (show a command only for the agent picked);
 * - which reason disables Rust in Register device, and which agent it opens on;
 * - the agent-aware update check (never the JS manifest for a Rust device);
 * - the one place the console is more lenient than the SDK: an old backend's
 *   un-echoed answer IS the JS manifest when JS was asked (review-wp-c S1).
 *
 * Read fields are `ReportedAgentKind` (a known kind, or a value newer than
 * this console). Narrow them with `isAgentKind()` before asking a channel.
 */
import {
  XorgateError,
  isAgentKind,
  isXorgateError,
  type AgentBuild,
  type AgentChannel,
  type AgentKind,
  type CreateDeviceRegistrationInput,
  type DeviceModel,
  type DeviceRegistration,
  type ReportedAgentKind,
} from "@xorgate/sdk"
import { xg } from "@/lib/xorgate"

export function agentLabel(agent: ReportedAgentKind): string {
  return agent === "js" ? "JS" : agent === "rust" ? "Rust" : agent
}

/** The systemd unit that runs `update` for this agent (D4), for operator hints. */
export function updaterUnit(
  agent: ReportedAgentKind | null | undefined
): string {
  return agent === "rust" ? "xorgate-updater-rs" : "xorgate-updater"
}

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

/**
 * The `create()` input for a pick. The JS agent leaves `agent` out, so a JS
 * registration with no model pin sends NO body, exactly as the console did
 * before Phase 8: byte-identical on the wire whatever the backend version.
 */
export function registrationInput(input: {
  agent: AgentKind
  deviceModelId?: string
}): CreateDeviceRegistrationInput {
  const out: CreateDeviceRegistrationInput = {}
  if (input.deviceModelId) out.deviceModelId = input.deviceModelId
  if (input.agent !== "js") out.agent = input.agent
  return out
}

/**
 * Mint (or reuse) a code for `agent`. Idempotent per workspace AND agent: a
 * pending code for the same agent comes back, a different agent mints a new
 * one (Q-8.2), and passing `deviceModelId` re-pins the pending code in place.
 *
 * Throws `INVALID_CONFIG` locally (sending nothing) without a workspace,
 * `AGENT_NOT_ENABLED` (409) when the stage's Rust flag says no for this
 * workspace, `INVALID_AGENT` (400) for an unknown agent.
 */
export async function createRegistration(input: {
  agent: AgentKind
  deviceModelId?: string
}): Promise<DeviceRegistration> {
  const client = xg()
  // The SDK refuses this too, but with a developer-facing message; the
  // operator gets the console's own wording.
  if (!client.workspaceId) {
    throw new XorgateError({
      code: "INVALID_CONFIG",
      message: "Registering a device needs a workspace. Select one first.",
    })
  }
  return client.deviceRegistrations.create(registrationInput(input))
}

/**
 * The M1 echo guard (D6.2): show an install command only when the code serves
 * the agent the operator picked. The SDK reads a missing `agent` (an old
 * backend) as `js`, which keeps JS working there; a Rust pick never matches,
 * so it fails closed. An agent newer than this console matches nothing.
 */
export function registrationMatchesPick(
  reg: { agent?: ReportedAgentKind | null } | null | undefined,
  pick: AgentKind
): boolean {
  if (!reg) return false
  return (reg.agent ?? "js") === pick
}

/** `AGENT_NOT_ENABLED` from create: the stage flag is off for this workspace. */
export function isAgentNotEnabled(err: unknown): boolean {
  return isXorgateError(err) && err.code === "AGENT_NOT_ENABLED"
}

/**
 * The agent a device runs right now, for a screen that holds its own snapshot
 * of the device (the settings hook's copy, refreshed only field by field).
 * The shared device query is the live source — the header reads it, and the
 * device layout polls it — so it wins; the snapshot is only a fallback while
 * that entry is empty. Null when neither knows.
 */
export function currentDeviceAgent(
  shared: { agent?: ReportedAgentKind | null } | null | undefined,
  snapshot: { agent?: ReportedAgentKind | null } | null | undefined
): ReportedAgentKind | null {
  return shared?.agent ?? snapshot?.agent ?? null
}

// ---------------------------------------------------------------------------
// The dist channel (GET /device-dist/latest?agent=)
// ---------------------------------------------------------------------------

/** What `devices.agentChannel()` reports for no echo (an old backend, or a 404). */
export const UNSUPPORTED_CHANNEL: AgentChannel = {
  agent: null,
  latest: null,
  registrationEnabled: false,
}

/**
 * One agent's channel. The SDK reports an answer that does not echo the agent
 * as `agent: null` (unsupported), which is exactly right for Rust: an old
 * backend ignores `?agent=` and answers with the JS manifest, and that must
 * never read as the Rust one.
 *
 * JS is the exception (review-wp-c S1). That un-echoed answer IS the JS
 * manifest, so a JS device keeps today's update check and the update dialog's
 * target version on an old backend. The SDK no longer passes the body
 * through, so this asks the no-parameter route (`latestAgentBuild()`, the JS
 * channel on every backend version) instead. It runs only when `?agent=js`
 * did not echo, which a current backend always does. A 404 there (nothing
 * published) stays unsupported, as before. Other failures throw.
 */
export async function fetchAgentChannel(
  agent: AgentKind
): Promise<AgentChannel> {
  const channel = await xg().devices.agentChannel(agent)
  if (agent !== "js" || channel.agent !== null) return channel
  const latest = await xg().devices.latestAgentBuild()
  if (latest === null) return UNSUPPORTED_CHANNEL
  // An old backend has no stage flag; JS registration is always open.
  return { agent: "js", latest, registrationEnabled: true }
}

/**
 * The channel query for a device's agent, minus the tenant key. An agent this
 * console does not know (a value newer than it) is never asked about: the
 * query is disabled, and even a forced run answers "unsupported" without a
 * request, so no "update available" dot can appear for it.
 */
export function agentChannelQuery(
  agent: ReportedAgentKind | null | undefined
): {
  known: AgentKind | null
  enabled: boolean
  queryFn: () => Promise<AgentChannel>
} {
  const known = isAgentKind(agent) ? agent : null
  return {
    known,
    enabled: known !== null,
    queryFn: () =>
      known === null
        ? Promise.resolve(UNSUPPORTED_CHANNEL)
        : fetchAgentChannel(known),
  }
}

// ---------------------------------------------------------------------------
// The Rust option in Register device (D5, D7, Q-8.5, Q-8.6)
// ---------------------------------------------------------------------------

export const RUST_REASON_CHECK_FAILED =
  "Could not check whether this stage offers the Rust agent"
export const RUST_REASON_OLD_API =
  "This API version does not support the Rust installer"
export const RUST_REASON_FLAG_OFF =
  "Rust registration is not enabled on this stage yet"
export const RUST_REASON_NO_RELEASE =
  "No Rust agent release is published for this stage yet"
export const RUST_HINT_CM4 =
  "The Rust agent is not yet verified on CM4 hardware"

export type RustOption =
  | { state: "checking" }
  | { state: "enabled" }
  | { state: "disabled"; reason: string }

/**
 * Whether Rust can be picked, and why not. `channel` is `undefined` while the
 * check is in flight, `null` when it failed outright. `refusedByCreate` is set
 * once a create came back `AGENT_NOT_ENABLED` — the authoritative answer,
 * whatever the channel said.
 */
export function rustOption(
  channel: AgentChannel | null | undefined,
  refusedByCreate = false
): RustOption {
  if (refusedByCreate)
    return { state: "disabled", reason: RUST_REASON_FLAG_OFF }
  if (channel === undefined) return { state: "checking" }
  if (channel === null) {
    return { state: "disabled", reason: RUST_REASON_CHECK_FAILED }
  }
  if (channel.agent !== "rust") {
    return { state: "disabled", reason: RUST_REASON_OLD_API }
  }
  if (!channel.registrationEnabled)
    return { state: "disabled", reason: RUST_REASON_FLAG_OFF }
  if (channel.latest === null)
    return { state: "disabled", reason: RUST_REASON_NO_RELEASE }
  return { state: "enabled" }
}

// ---------------------------------------------------------------------------
// The Language picker in Register device (2026-11-18: Rust first and the
// default where it is offered; supersedes Q-8.15's "JS until the cutover")
// ---------------------------------------------------------------------------

/** The picker's label. It said "Agent" in Phase 8. */
export const REGISTER_PICK_LABEL = "Language"

/** Rust first, then JS. The keyboard order follows it. */
export const REGISTER_PICK_ORDER: readonly AgentKind[] = ["rust", "js"]

/**
 * How long the dialog waits for the Rust check before it opens on JS anyway.
 * It only applies when no fresh cached answer exists (the channel is cached
 * per workspace for 60 s and prefetched with the Devices page). A warm check
 * answers in a fraction of a second, but a cold API (Lambda and the Aurora
 * resume after an idle period) took about 3 s on DEV; this bounds anything
 * slower (the SDK's own deadline is 30 s). A late answer still updates the
 * Rust option, but never moves the pick: the default is decided once per open.
 */
export const RUST_CHECK_DEADLINE_MS = 8000

export type RegisterPickOption = {
  value: AgentKind
  label: string
  disabled: boolean
  title?: string
}

/** The picker's options, in `REGISTER_PICK_ORDER`. JS is never disabled. */
export function registerPickOptions(
  rust: RustOption,
  cm4Picked: boolean
): RegisterPickOption[] {
  return REGISTER_PICK_ORDER.map((value) =>
    value === "js"
      ? { value, label: agentLabel(value), disabled: false }
      : {
          value,
          label: agentLabel(value),
          disabled: rust.state !== "enabled",
          title:
            rust.state === "disabled"
              ? rust.reason
              : rust.state === "checking"
                ? "Checking whether this stage offers the Rust agent…"
                : cm4Picked
                  ? RUST_HINT_CM4
                  : undefined,
        }
  )
}

/**
 * The agent the dialog opens on, decided once per open: Rust when this
 * workspace can register it, JS for every reason it cannot, so registration
 * never starts on a disabled option. Null while the check is in flight — the
 * dialog mints nothing until then, so no JS code is created only to be
 * replaced by a Rust one.
 *
 * The CM4 hint plays no part: it only follows a model pin, which comes after
 * the first code, and it warns rather than disables.
 */
export function defaultRegistrationAgent(rust: RustOption): AgentKind | null {
  if (rust.state === "checking") return null
  return rust.state === "enabled" ? "rust" : "js"
}

/** A CM4 model (cm4-support schema-v2 `system.platform`), for the D7 hint. */
export function isCm4Model(model: DeviceModel | null | undefined): boolean {
  const sys = (
    model?.ioCapabilities as
      | { system?: { platform?: unknown } }
      | null
      | undefined
  )?.system
  return sys?.platform === "rpi-cm4"
}

// ---------------------------------------------------------------------------
// "Update available", per agent (D4, D6.3)
// ---------------------------------------------------------------------------

export type AgentUpdateState =
  /** Not known yet, the device's agent is one this console does not know, or the channel did not echo it. */
  | { kind: "unknown" }
  /** The channel answered for this agent, but nothing is published for it. */
  | { kind: "no-build" }
  | { kind: "up-to-date"; latest: AgentBuild }
  | { kind: "update-available"; latest: AgentBuild }
  /** A published build, but the device has never reported one to compare. */
  | { kind: "unreported"; latest: AgentBuild }

/**
 * Compare a device against ITS agent's channel. The channel is used only when
 * it echoes the device's agent (an old backend answers every `?agent=` with the
 * JS manifest), and string equality only: a sha has no order.
 */
export function agentUpdateState(input: {
  deviceAgent: ReportedAgentKind | null | undefined
  channel: AgentChannel | null | undefined
  installedVersion: string | null
}): AgentUpdateState {
  const { deviceAgent, channel, installedVersion } = input
  if (!isAgentKind(deviceAgent) || !channel || channel.agent !== deviceAgent) {
    return { kind: "unknown" }
  }
  if (channel.latest === null) return { kind: "no-build" }
  if (installedVersion === null)
    return { kind: "unreported", latest: channel.latest }
  return channel.latest.version === installedVersion
    ? { kind: "up-to-date", latest: channel.latest }
    : { kind: "update-available", latest: channel.latest }
}
