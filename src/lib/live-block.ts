import type { LiveBlockState } from "@xorgate/react"
import type { SettingsTab } from "@/lib/device-settings-tabs"
import {
  BatteryWarningIcon,
  CirclePauseIcon,
  SatelliteDishIcon,
  ThermometerSunIcon,
  VideoOffIcon,
  type LucideIcon,
} from "lucide-react"

/**
 * Live-stream block, the APP half (power_management_improvements plan, Phase
 * 3). The judgement — fail-open on absence, staleness, the parked flag, clock
 * clamping — lives in `@xorgate/react`'s `resolveLiveBlock`/`useLiveBlock`;
 * what stays here is the reason → descriptor registry with its icons and
 * copy, and the per-tile precedence (`selectStreamTile`). This split is the
 * package boundary working as designed: verdict in the package, presentation
 * in the app.
 */

/**
 * Don't render an elapsed time for a block younger than this — "paused for 3s"
 * is noise, and it would tick distractingly on a tile that has no other motion.
 */
const ELAPSED_MIN_MS = 30_000

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
  /**
   * Where the operator can act on this. `tab` deep-links into the settings
   * sub-tab that actually holds the relevant control — without it the link
   * lands on General and the operator has to hunt for it.
   */
  action?: { label: string; to: "settings"; tab?: SettingsTab }
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
      "connection. This clears on its own.",
  },
  undervoltage: {
    icon: BatteryWarningIcon,
    title: "Live view paused — the power supply is struggling",
    description:
      "Live streaming was dropped first to protect recording, which is still " +
      "running. It returns once the supply recovers.",
    action: { label: "Open power settings", to: "settings", tab: "power" },
  },
  thermal: {
    icon: ThermometerSunIcon,
    title: "Live view paused — the device is too hot",
    description:
      "Live streaming stops so the device can cool down; recording keeps " +
      "running. It resumes once the device has cooled — minutes, not seconds.",
    action: { label: "Open power settings", to: "settings", tab: "power" },
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
    "The device says live streaming is unavailable, for a reason this version " +
    "of the web app doesn't recognise. Its own explanation is below.",
  action: { label: "Open device settings", to: "settings" },
}

/**
 * Appended when the shed has exhausted its rolling-hour cycle cap
 * (`recording.powerShed` prefixed `parked:`). A parked shed does NOT recover on
 * its own — it holds until the device reboots or its power settings change — so
 * saying "this resumes once it cools" would be a lie.
 */
const PARKED_NOTE =
  "It has paused too many times in the last hour and will not resume on its " +
  "own — restart the device or change its power settings."

/** The disabled-camera case — the first caller of the generalized tile. */
export function disabledCameraDescriptor(
  label: string
): UnavailableStreamDescriptor {
  return {
    icon: VideoOffIcon,
    title: `${label} is turned off`,
    action: { label: "Open camera settings", to: "settings", tab: "media" },
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

/** "2m" / "1h 5m". Minute granularity — a paused tile needs no seconds. */
export function formatBlockedFor(elapsedMs: number): string {
  const mins = Math.floor(elapsedMs / 60_000)
  if (mins < 60) return `${Math.max(1, mins)}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`
}

/**
 * Turn the package's blocked verdict into tile copy. The package hands back
 * plain data (`reason`, `detail`, `elapsedMs`, `parked`); everything rendered
 * — icons, copy, the parked warning, the elapsed note, the settings deep-link
 * — is decided here.
 */
export function describeLiveBlock(
  state: Extract<LiveBlockState, { blocked: true }>
): UnavailableStreamDescriptor {
  const base = describeLiveBlockReason(state.reason)
  return {
    ...base,
    description: state.parked
      ? `${base.description ?? ""} ${PARKED_NOTE}`.trim()
      : base.description,
    detail: state.detail || undefined,
    note:
      state.elapsedMs !== null && state.elapsedMs >= ELAPSED_MIN_MS
        ? `Paused for ${formatBlockedFor(state.elapsedMs)}`
        : undefined,
    // A parked shed needs the settings escape hatch even for a reason whose
    // descriptor carries no action of its own.
    action:
      base.action ??
      (state.parked
        ? { label: "Open power settings", to: "settings", tab: "power" }
        : undefined),
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
 * `kind !== "player"` is exactly the guarantee that the live-video hook never
 * mounts, so nothing loops against a master the device deliberately SIGINT'd.
 */
export type StreamTileSelection =
  | { kind: "player" }
  | { kind: "disabled"; descriptor: UnavailableStreamDescriptor }
  | { kind: "blocked"; descriptor: UnavailableStreamDescriptor }

export function selectStreamTile(input: {
  streamKey: string
  /** From `config.recording.video.cameras`; an ABSENT key means enabled. */
  label: string
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
    return { kind: "blocked", descriptor: describeLiveBlock(input.liveBlock) }
  }
  return { kind: "player" }
}
