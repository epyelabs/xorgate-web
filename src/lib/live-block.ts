import {
  BatteryWarningIcon,
  CirclePauseIcon,
  SatelliteDishIcon,
  ThermometerSunIcon,
  VideoOffIcon,
  type LucideIcon,
} from "lucide-react"

/**
 * Live-stream block: the browser side of the device's `recording.liveBlock`
 * verdict (power_management_improvements plan, Phase 3).
 *
 * The device parks every KVS master at once when the GPS/LTE boot gate is armed
 * or the load-shed ladder is at rung 1, and publishes WHY. This module turns
 * that verdict into "render a tile instead of a player, with this copy" — as
 * PURE functions, so the whole decision (fail-open, staleness, precedence,
 * unknown reasons, a skewed device clock) is testable without a DOM.
 *
 * Two rules govern everything here, and they pull in opposite directions:
 *
 *  1. **Fail open on ABSENCE.** No feed, no payload yet, a stale payload, an
 *     agent too old to send the field, a `recording` block that failed
 *     validation — every one of them means SHOW THE PLAYER (README principle
 *     1). A gate that blocks on missing information is a worse bug than the
 *     black tile it replaces; the cost of being wrong in this direction is one
 *     timed-out connection attempt, which is exactly today's behavior.
 *
 *  2. **Honour an unrecognised reason (Q7).** `reason` is an OPEN string on the
 *     wire, and this registry is the only place it is ever narrowed. A reason
 *     this build has never heard of still blocks — with generic copy — because
 *     the device explicitly SAID blocked. That is presence, not absence, so it
 *     does not contradict rule 1.
 */

/**
 * How old the last telemetry payload may be before `liveBlock` stops counting.
 * The feed is 1 Hz, so 30 s is ~30 missed ticks: comfortably past a hiccup,
 * well short of leaving an operator staring at a stale verdict. A device that
 * drops off the air mid-block therefore falls back to the normal player path
 * (which then shows "Waiting for device") rather than latching blocked forever.
 */
export const LIVE_BLOCK_STALE_MS = 30_000

/**
 * Don't render an elapsed time for a block younger than this — "paused for 3s"
 * is noise, and it would tick distractingly on a tile that has no other motion.
 */
const ELAPSED_MIN_MS = 30_000

/**
 * `since` is epoch ms in the DEVICE's clock domain, not the browser's. A device
 * whose RTC has not synced yet (the 2026-07-24 rtc-vs-ntp observation) can
 * publish a `since` that makes the arithmetic absurd or negative. Anything
 * outside [0, 24 h) is treated as unusable and simply not rendered — the block
 * itself still stands; only the "for how long" garnish is dropped.
 */
const ELAPSED_MAX_MS = 24 * 60 * 60 * 1000

/**
 * What to show in place of a player. Deliberately plain data (no JSX), so the
 * registry below is a literal and every branch here is unit-testable.
 *
 * The shape must NOT assume "power": a future `failed`-master tile or a
 * decommissioned-device tile is another descriptor, not another component.
 */
export interface UnavailableStreamDescriptor {
  icon: LucideIcon
  /** Headline. One line, sentence case. */
  title: string
  /** What it means for the operator, and what happens next. */
  description?: string
  /**
   * Device prose (`liveBlock.detail`) — e.g. `cpu 66.1°C >= 60°C for 5s`.
   * Displayed verbatim as secondary text and NEVER parsed. It is the rationale
   * that STARTED the block and does not track live numbers, so a thermal block
   * that fired at 66.1 °C keeps saying 66.1 °C for its whole life.
   */
  detail?: string
  /** Extra muted line — currently the clamped "Paused for 2m". */
  note?: string
  /** Optional call to action. `to` is a destination key, not a URL. */
  action?: { label: string; to: "settings" }
}

/** The `recording.liveBlock` object as it arrives from the device. */
export interface LiveBlockPayload {
  reason: string
  detail: string
  since: number
}

/**
 * Reason → descriptor registry (Q7). **Adding a future block reason must be one
 * entry here and nothing else** — no `switch` in a component, no
 * reason-specific branching in the grid.
 *
 * Copy rules, learned from the bench measurements:
 *  - `gps-gate` genuinely ends (an LTE attach, a fix, or the give-up cap) and
 *    is boot-time-only — the gate is one-shot per process — so promising it
 *    clears on its own is honest.
 *  - The shed reasons may appear at any time, repeat, and take ~4 minutes to
 *    recover at BEST (~100 s to fall below the restore point + a 120 s clean
 *    interval). Copy must not imply an imminent return.
 */
export const LIVE_BLOCK_DESCRIPTORS: Record<
  string,
  Omit<UnavailableStreamDescriptor, "detail" | "note">
> = {
  "gps-gate": {
    icon: SatelliteDishIcon,
    title: "Live view paused while the device starts up",
    description:
      "The device is conserving power until it has a GPS fix and a cellular " +
      "connection. This clears on its own — live view returns as soon as the " +
      "device is ready.",
  },
  undervoltage: {
    icon: BatteryWarningIcon,
    title: "Live view paused — the power supply is struggling",
    description:
      "The device dropped live streaming first to protect recording, which is " +
      "still running. Live view returns once the supply recovers; check the " +
      "vehicle's power feed if this keeps happening.",
    action: { label: "Open device settings", to: "settings" },
  },
  thermal: {
    icon: ThermometerSunIcon,
    title: "Live view paused — the device is too hot",
    description:
      "Live streaming stops so the device can cool down. Recording keeps " +
      "running. This resumes once the device has cooled below its restore " +
      "temperature — expect several minutes, not seconds.",
    action: { label: "Open device settings", to: "settings" },
  },
}

/**
 * Fallback for a reason this build doesn't recognise — a newer device against
 * an older web build is a normal deployment state. Generic copy, still no
 * player. The device's own `detail` rides along, so an operator (or a support
 * engineer reading a screenshot) can still see what the device said.
 */
export const GENERIC_LIVE_BLOCK: Omit<
  UnavailableStreamDescriptor,
  "detail" | "note"
> = {
  icon: CirclePauseIcon,
  title: "Live view paused",
  description:
    "The device reported that live streaming is unavailable right now. This " +
    "version of the web app doesn't recognise the reason it gave — the " +
    "device's own explanation is below.",
  action: { label: "Open device settings", to: "settings" },
}

/**
 * Appended when the shed has exhausted its rolling-hour cycle cap
 * (`recording.powerShed` prefixed `parked:`). A parked shed does NOT recover on
 * its own — it holds until the device reboots or its power settings change — so
 * saying "this resumes once it cools" would be a lie.
 */
const PARKED_NOTE =
  "The device has paused too many times in the last hour and will not resume " +
  "live view on its own. Restart the device, or change its power settings, to " +
  "clear this."

/** The disabled-camera case — the first caller of the generalized tile. */
export function disabledCameraDescriptor(
  label: string
): UnavailableStreamDescriptor {
  return {
    icon: VideoOffIcon,
    title: `${label} is turned off`,
    action: { label: "Open device settings", to: "settings" },
  }
}

/**
 * Narrow an open-set reason to a descriptor. The ONLY narrowing point.
 *
 * `Object.hasOwn`, not a plain lookup: `reason` is an arbitrary string off the
 * wire, so `LIVE_BLOCK_DESCRIPTORS["constructor"]` would otherwise hand back
 * `Object` — a function masquerading as a descriptor, which then crashes the
 * render. A device is unlikely to send that, but "unlikely" is not a property
 * we get to rely on for an open set.
 */
export function describeLiveBlockReason(
  reason: string
): Omit<UnavailableStreamDescriptor, "detail" | "note"> {
  return Object.hasOwn(LIVE_BLOCK_DESCRIPTORS, reason)
    ? LIVE_BLOCK_DESCRIPTORS[reason]
    : GENERIC_LIVE_BLOCK
}

/**
 * Elapsed block duration in ms, or null when the device's clock makes the
 * arithmetic untrustworthy (negative, or implausibly large). Clamping rather
 * than trusting is deliberate: see ELAPSED_MAX_MS.
 */
export function liveBlockElapsedMs(since: number, now: number): number | null {
  if (!Number.isFinite(since) || !Number.isFinite(now)) return null
  const elapsed = now - since
  if (elapsed < 0 || elapsed >= ELAPSED_MAX_MS) return null
  return elapsed
}

/** "2m" / "1h 5m". Minute granularity — a paused tile needs no seconds. */
export function formatBlockedFor(elapsedMs: number): string {
  const mins = Math.floor(elapsedMs / 60_000)
  if (mins < 60) return `${Math.max(1, mins)}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`
}

/** Why we resolved to "not blocked" — carried for tests and for debugging. */
export type LiveBlockOpenReason =
  | "feed-not-connected"
  | "no-payload"
  | "stale-payload"
  | "no-live-block"

export type LiveBlockState =
  | { blocked: false; why: LiveBlockOpenReason }
  | {
      blocked: true
      reason: string
      descriptor: UnavailableStreamDescriptor
    }

export interface ResolveLiveBlockInput {
  /** The telemetry feed's connection status. */
  status: "connecting" | "connected" | "error" | "closed"
  /**
   * The last `recording` block seen, or null if none yet. Note a MALFORMED
   * block arrives here as null too: the schema's `.catch(undefined)` wraps the
   * whole object, so "no recording block" and "no liveBlock" are the same case
   * by construction — and both fail open.
   */
  recording: {
    liveBlock?: LiveBlockPayload
    powerShed?: string
  } | null
  /** Browser-clock ms when the last payload arrived, or null if none has. */
  receivedAt: number | null
  /** Browser-clock now. Injected so staleness is testable. */
  now: number
}

/**
 * The one place "is live blocked, and with what copy?" is decided.
 *
 * Every early return below is a fail-open branch; only the final block is a
 * block. Read them as a list of the ways we refuse to trust the verdict.
 */
export function resolveLiveBlock(input: ResolveLiveBlockInput): LiveBlockState {
  const { status, recording, receivedAt, now } = input

  // The verdict is only meaningful while the feed is live. `connecting` /
  // `closed` / `error` all mean we cannot know, so we allow.
  if (status !== "connected")
    return { blocked: false, why: "feed-not-connected" }

  // Nothing has arrived yet — including from an agent too old to send the field
  // (it sends a `recording` block without `liveBlock`, handled below).
  if (!recording || receivedAt === null) {
    return { blocked: false, why: "no-payload" }
  }

  // The device went quiet while we stayed connected to the broker (the exact
  // shape of "device lost MQTT mid-block"). Without this the tile would latch
  // blocked with no way to clear.
  if (now - receivedAt >= LIVE_BLOCK_STALE_MS) {
    return { blocked: false, why: "stale-payload" }
  }

  const block = recording.liveBlock
  if (!block) return { blocked: false, why: "no-live-block" }

  const base = describeLiveBlockReason(block.reason)
  const parked = recording.powerShed?.startsWith("parked:") === true
  const elapsed = liveBlockElapsedMs(block.since, now)

  return {
    blocked: true,
    reason: block.reason,
    descriptor: {
      ...base,
      description: parked
        ? `${base.description ?? ""} ${PARKED_NOTE}`.trim()
        : base.description,
      detail: block.detail || undefined,
      note:
        elapsed !== null && elapsed >= ELAPSED_MIN_MS
          ? `Paused for ${formatBlockedFor(elapsed)}`
          : undefined,
      // A parked shed needs the settings escape hatch even for a reason whose
      // descriptor carries no action of its own.
      action:
        base.action ??
        (parked
          ? { label: "Open device settings", to: "settings" }
          : undefined),
    },
  }
}

/**
 * What a single grid cell should render. Extracted from the component so the
 * PRECEDENCE — the property D3 rests on — is unit-testable:
 *
 *  1. camera disabled in settings  → disabled tile (device-level config beats a
 *     transient condition; the camera would be off either way)
 *  2. `liveBlock` present          → blocked tile
 *  3. otherwise                    → the player
 *
 * `kind !== "player"` is exactly the guarantee that `useKvsViewer` never
 * mounts, so nothing loops against a master the device deliberately SIGINT'd.
 */
export type StreamTileSelection =
  | { kind: "player" }
  | { kind: "disabled"; descriptor: UnavailableStreamDescriptor }
  | { kind: "blocked"; descriptor: UnavailableStreamDescriptor }

export function selectStreamTile(input: {
  streamKey: string
  label: string
  /** From `recordingConfig.video.cameras`; an ABSENT key means enabled. */
  cameraEnables?: Record<string, boolean>
  liveBlock: LiveBlockState
}): StreamTileSelection {
  if (input.cameraEnables?.[input.streamKey] === false) {
    return {
      kind: "disabled",
      descriptor: disabledCameraDescriptor(input.label),
    }
  }
  // Device-wide by construction: rung 1 parks every master at once, so this
  // applies to every channel simultaneously and never to a subset.
  if (input.liveBlock.blocked) {
    return { kind: "blocked", descriptor: input.liveBlock.descriptor }
  }
  return { kind: "player" }
}
