/**
 * Dual-agent registration, console side (device-agent-js-to-rust Phase 8,
 * D6), over the SDK's raw `request()`.
 *
 * TEMPORARY SHIM (D6.5, Q-8.13). The installed `@xorgate/sdk` (0.15) knows
 * nothing about `agent`: its `deviceRegistrations.create()` drops it from the
 * body, and its `normalizeDevice` strips it from every device it returns.
 * SDK 0.17.0 adds all of it (`AgentKind`, `isAgentKind()`, `agent` on
 * registrations and devices, `devices.agentChannel()`). WP-C2 bumps the SDK and
 * deletes this file, replacing each export with its 0.17.0 equivalent:
 *
 *   createRegistration()  → xg().deviceRegistrations.create({ agent, deviceModelId })
 *   getRegistration()     → xg().deviceRegistrations.get(code)
 *   fetchAgentChannel()   → xg().devices.agentChannel(agent)
 *   fetchDeviceAgent()    → device.agent (on every Device)
 *   fetchFleetAgents()    → device.agent (on every Device)
 *   isAgentKind()         → isAgentKind from @xorgate/sdk
 *
 * The pure helpers below (the echo guard, the Rust option state, the update
 * check) stay; only their inputs change source.
 *
 * Two rules the SDK applies for 0.17.0 consumers have to be applied HERE,
 * because raw responses are not normalised (review-wp-s S2):
 *
 * 1. A missing `agent` is `js` — an old backend predates the column, and every
 *    device and code it knows is the JS agent (plan M1).
 * 2. A channel counts only when the backend ECHOES the agent asked for. An old
 *    backend ignores `?agent=` and answers with the JS manifest, which must
 *    never be read as the Rust one (review-plan S2). The one exception is the
 *    JS channel: that un-echoed 200 body IS the JS manifest, so a JS device
 *    keeps today's update check on an old backend (review-wp-c S1).
 */
import {
  XorgateError,
  isXorgateError,
  type AgentBuild,
  type DeviceModel,
  type DeviceRegistration,
} from "@xorgate/sdk"
import { xg } from "@/lib/xorgate"

/** The agents this console can register. Mirrors SDK 0.17.0 `AgentKind`. */
export type AgentKind = "js" | "rust"

/**
 * An agent as READ from the API: a known kind, or a value newer than this
 * console. Mirrors SDK 0.17.0 `ReportedAgentKind`; narrow it with
 * `isAgentKind()` before using it as an `AgentKind`.
 */
export type ReportedAgentKind = AgentKind | (string & {})

export function isAgentKind(value: unknown): value is AgentKind {
  return value === "js" || value === "rust"
}

/** A missing or empty `agent` (an old backend) is the JS agent; anything else passes through. */
export function agentOrJs(value: unknown): ReportedAgentKind {
  return typeof value === "string" && value !== "" ? value : "js"
}

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

/** A registration with the agent its install URL serves (`js` on an old backend). */
export type AgentRegistration = DeviceRegistration & {
  agent: ReportedAgentKind
}

export function normalizeRegistration(raw: unknown): AgentRegistration {
  const row = (raw ?? {}) as DeviceRegistration & { agent?: unknown }
  return { ...row, agent: agentOrJs(row.agent) }
}

/**
 * The request body for `POST /device-registrations`. The JS agent with no model
 * pin sends NO body, exactly as the console did before Phase 8, so a JS
 * registration is byte-identical on the wire whatever the backend version.
 */
export function registrationBody(input: {
  agent: AgentKind
  deviceModelId?: string
}): { agent?: AgentKind; deviceModelId?: string } | undefined {
  const body: { agent?: AgentKind; deviceModelId?: string } = {}
  if (input.deviceModelId) body.deviceModelId = input.deviceModelId
  if (input.agent !== "js") body.agent = input.agent
  return Object.keys(body).length > 0 ? body : undefined
}

/**
 * Mint (or reuse) a code for `agent`. Idempotent per workspace AND agent: a
 * pending code for the same agent comes back, a different agent mints a new
 * one (Q-8.2), and passing `deviceModelId` re-pins the pending code in place.
 *
 * Throws `AGENT_NOT_ENABLED` (409) when the stage's Rust flag says no for this
 * workspace, `INVALID_AGENT` (400) for an unknown agent.
 */
export async function createRegistration(input: {
  agent: AgentKind
  deviceModelId?: string
}): Promise<AgentRegistration> {
  const client = xg()
  // The SDK's own create refuses locally without a workspace; keep that, so a
  // missing workspace never reaches the API as a header-less request.
  if (!client.workspaceId) {
    throw new XorgateError({
      code: "INVALID_CONFIG",
      message: "Registering a device needs a workspace. Select one first.",
    })
  }
  const body = registrationBody(input)
  const raw = await client.request(
    "POST",
    "/device-registrations",
    body ? { body } : {}
  )
  return normalizeRegistration(raw)
}

/** Reading lazily expires a stale pending code. */
export async function getRegistration(
  code: string
): Promise<AgentRegistration> {
  const raw = await xg().request(
    "GET",
    `/device-registrations/${encodeURIComponent(code)}`
  )
  return normalizeRegistration(raw)
}

/**
 * The M1 echo guard (D6.2): show an install command only when the code serves
 * the agent the operator picked. `?? 'js'` is what keeps JS working against an
 * old backend that returns no `agent` at all; a Rust pick there never matches,
 * so it fails closed.
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
  return isXorgateError(err) && (err.code as string) === "AGENT_NOT_ENABLED"
}

// ---------------------------------------------------------------------------
// The dist channel (GET /device-dist/latest?agent=)
// ---------------------------------------------------------------------------

/** Mirrors SDK 0.17.0 `AgentChannel`. */
export interface AgentChannel {
  /** The agent the backend says this answer is about; null = no echo (an old backend, or a 404). */
  agent: ReportedAgentKind | null
  /** The newest published build; null = nothing published (or no echo). */
  latest: AgentBuild | null
  /** The stage's Rust flag for this workspace; false when there is no echo. */
  registrationEnabled: boolean
}

export const UNSUPPORTED_CHANNEL: AgentChannel = {
  agent: null,
  latest: null,
  registrationEnabled: false,
}

/**
 * Reads a 200 `?agent=` body for the agent that was asked about. No echoed
 * agent is today's JS-only shape from an old backend that ignored `?agent=`:
 * unsupported for Rust (that body is the JS manifest, never the Rust one), but
 * exactly the JS manifest when JS was asked (review-wp-c S1), so a JS device
 * keeps its update check and the update dialog's target version.
 */
export function channelFromBody(body: unknown, asked: AgentKind): AgentChannel {
  const row =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {}
  const echoed = row["agent"]
  if (typeof echoed !== "string" || echoed === "") {
    if (asked !== "js") return UNSUPPORTED_CHANNEL
    return {
      agent: "js",
      latest: (row["latest"] as AgentBuild | null | undefined) ?? null,
      // An old backend has no stage flag; JS registration is always open.
      registrationEnabled: true,
    }
  }
  return {
    agent: echoed,
    latest: (row["latest"] as AgentBuild | null | undefined) ?? null,
    registrationEnabled: row["registrationEnabled"] === true,
  }
}

/**
 * One agent's channel. The current backend always answers 200 (`latest: null`
 * when nothing is published); only an old one 404s, which reads as
 * unsupported. Other failures throw.
 */
export async function fetchAgentChannel(
  agent: AgentKind
): Promise<AgentChannel> {
  let body: unknown
  try {
    body = await xg().request("GET", "/device-dist/latest", {
      query: { agent },
    })
  } catch (e) {
    if (isXorgateError(e) && e.code === "NOT_FOUND") return UNSUPPORTED_CHANNEL
    throw e
  }
  return channelFromBody(body, agent)
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
// Devices: which agent a device runs
// ---------------------------------------------------------------------------

/** `devices.agent` for one device (`js` on an old backend). */
export async function fetchDeviceAgent(
  deviceId: string
): Promise<ReportedAgentKind> {
  const body = await xg().request<{ device?: { agent?: unknown } }>(
    "GET",
    `/devices/${encodeURIComponent(deviceId)}`
  )
  return agentOrJs(body?.device?.agent)
}

const FLEET_AGENT_PAGE = 500
const FLEET_AGENT_CAP = 5000

/** `devices.agent` for the whole fleet, keyed by device id (`js` on an old backend). */
export async function fetchFleetAgents(): Promise<
  Record<string, ReportedAgentKind>
> {
  const out: Record<string, ReportedAgentKind> = {}
  let offset = 0
  let total = Infinity
  let seen = 0
  while (offset < total && seen < FLEET_AGENT_CAP) {
    const body = await xg().request<{
      devices?: { id?: unknown; agent?: unknown }[]
      page?: { total?: number }
    }>("GET", "/devices", { query: { limit: FLEET_AGENT_PAGE, offset } })
    const items = body?.devices ?? []
    for (const d of items) {
      if (typeof d.id === "string") out[d.id] = agentOrJs(d.agent)
    }
    seen += items.length
    total = typeof body?.page?.total === "number" ? body.page.total : 0
    if (items.length === 0) break
    offset += FLEET_AGENT_PAGE
  }
  return out
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
