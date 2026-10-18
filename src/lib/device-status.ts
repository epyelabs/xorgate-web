import {
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

export interface StatusLegendEntry {
  code: number
  label: string
  color: string
  /** Total time spent in this code across the runs, ms. */
  totalMs: number
}

/** One entry per code present in the runs, ascending by code (severity). */
export function statusLegend(runs: StatusRun[]): StatusLegendEntry[] {
  const totals = new Map<number, number>()
  for (const r of runs) {
    totals.set(
      r.code,
      (totals.get(r.code) ?? 0) + Math.max(0, r.toTs - r.fromTs)
    )
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a - b)
    .map(([code, totalMs]) => {
      const status = deviceStatusFor(code)!
      return { code, label: status.label, color: status.color, totalMs }
    })
}
