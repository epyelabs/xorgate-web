import {
  DEVICE_STATUS_CODES,
  decodeHealthFlags,
  deviceStatusFor,
  type StatusRun,
} from "@xorgate/react"

// View models for the status-LED telemetry (`system.led_state` code +
// `system.health_flags` bitmask). The code / flag tables live in
// @xorgate/react (DEVICE_STATUS_CODES, HEALTH_FLAG_BITS) so every app names
// and colours the states the same way as the LED on the kit; this file only
// decides what the console shows.

/** The healthy code: never charted as a problem, never chipped. */
export const HEALTHY_STATUS_CODE = 0

export interface DeviceStatusChipModel {
  code: number
  label: string
  /** The LED's own colour for this code (hex), from DEVICE_STATUS_CODES. */
  color: string
  /** Labels of the set health flags, lowest bit first. */
  flags: string[]
}

/**
 * What the header chip shows, or null when it shows nothing. Owner rule
 * (plan §6 Q4): the chip appears only while the device is struggling, so it
 * is hidden when the device is offline (a stale code says nothing about now),
 * when there is no reading, and when the code is healthy (0).
 */
export function deviceStatusChipModel({
  ledState,
  healthFlags,
  online,
}: {
  ledState?: number | null
  healthFlags?: number | null
  online: boolean
}): DeviceStatusChipModel | null {
  if (!online) return null
  const status = deviceStatusFor(ledState)
  if (!status || status.code === HEALTHY_STATUS_CODE) return null
  return {
    code: status.code,
    label: status.label,
    color: status.color,
    flags:
      typeof healthFlags === "number"
        ? decodeHealthFlags(healthFlags).map((f) => f.label)
        : [],
  }
}

/** The run covering `ts` (runs are ascending and non-overlapping), or null. */
export function statusRunAt(runs: StatusRun[], ts: number): StatusRun | null {
  let lo = 0
  let hi = runs.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const run = runs[mid]
    if (ts < run.fromTs) hi = mid - 1
    else if (ts >= run.toTs) lo = mid + 1
    else return run
  }
  return null
}

/** One-line meaning of each `system.led_state` code, for the colour key. */
const STATUS_MEANINGS: Record<number, string> = {
  0: "Everything is working: GPS fixed, network and cloud link up.",
  1: "The agent is starting up and has not checked its subsystems yet.",
  2: "GPS is waiting for a position fix.",
  3: "The network is recovering: LTE or the cloud link is down.",
  4: "The device is hot and the CPU is being throttled.",
  5: "The power supply voltage is too low (undervoltage).",
  6: "The device agent crashed or stopped and is not running.",
}

/** The one-line meaning of a code (its label for a code the table lacks). */
export function deviceStatusMeaning(code: number): string {
  return STATUS_MEANINGS[code] ?? deviceStatusFor(code)?.label ?? String(code)
}

export interface DeviceStatusDotModel {
  code: number
  label: string
  color: string
  meaning: string
  /** Labels of the set health flags ("Reported faults"), lowest bit first. */
  faults: string[]
}

/**
 * The Device status dialog's model (and the System card dot's, which also
 * hides it while healthy), or null: offline (a stale code says nothing about
 * now) or no `system.led_state` reading.
 */
export function deviceStatusDotModel({
  ledState,
  healthFlags,
  online,
}: {
  ledState?: number | null
  healthFlags?: number | null
  online: boolean
}): DeviceStatusDotModel | null {
  if (!online) return null
  const status = deviceStatusFor(ledState)
  if (!status) return null
  return {
    code: status.code,
    label: status.label,
    color: status.color,
    meaning: deviceStatusMeaning(status.code),
    faults:
      typeof healthFlags === "number"
        ? decodeHealthFlags(healthFlags).map((f) => f.label)
        : [],
  }
}

export interface DeviceStatusKeyEntry {
  code: number
  label: string
  color: string
  meaning: string
}

/**
 * The colour key: every code in DEVICE_STATUS_CODES (not only the ones a
 * replay contains), by severity, with its LED colour and a one-line meaning.
 */
export function deviceStatusKey(): DeviceStatusKeyEntry[] {
  return Object.entries(DEVICE_STATUS_CODES)
    .map(([k, v]) => ({ code: Number(k), ...v }))
    .sort((a, b) => a.code - b.code)
    .map(({ code, label, color }) => ({
      code,
      label,
      color,
      meaning: deviceStatusMeaning(code),
    }))
}

/** localStorage key of the replay scrubber's device-status overlay toggle. */
export const STATUS_OVERLAY_STORAGE_KEY = "xg.replay.statusOverlay"

type PrefStorage = Pick<Storage, "getItem" | "setItem">

function defaultStorage(): PrefStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** The viewer's overlay choice; off by default and whenever storage fails. */
export function readStatusOverlayPref(
  storage: PrefStorage | null = defaultStorage()
): boolean {
  try {
    return storage?.getItem(STATUS_OVERLAY_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

/** Remembers the overlay choice; a storage failure only loses the memory. */
export function writeStatusOverlayPref(
  on: boolean,
  storage: PrefStorage | null = defaultStorage()
): void {
  try {
    storage?.setItem(STATUS_OVERLAY_STORAGE_KEY, on ? "1" : "0")
  } catch {
    // Private window / blocked site data: the toggle still works this visit.
  }
}
