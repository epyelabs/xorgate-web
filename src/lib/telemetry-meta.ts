// Friendly labels for the `<group>.<field>` telemetry metric keys.
export const METRIC_LABELS: Record<string, string> = {
  "imu.quat_r": "Quat R",
  "imu.quat_i": "Quat I",
  "imu.quat_j": "Quat J",
  "imu.quat_k": "Quat K",
  "imu.euler_roll": "Roll",
  "imu.euler_pitch": "Pitch",
  "imu.euler_yaw": "Yaw",
  "imu.accel_x": "Accel X",
  "imu.accel_y": "Accel Y",
  "imu.accel_z": "Accel Z",
  "gps.lat": "Latitude",
  "gps.lon": "Longitude",
  "gps.alt": "Altitude",
  "gps.speed": "Speed",
  "gps.course": "Course",
  "gps.satellites": "Satellites",
  "gps.fix_quality": "Fix Quality",
  "gps.satellites_in_view": "Sats in View",
  "gps.hdop": "HDOP",
  "lte.rssi": "LTE RSSI",
  "lte.quality": "LTE Quality",
  "lte.modem_temp": "Modem Temp",
  "system.cpu_usage": "CPU Usage",
  "system.cpu_temp": "CPU Temp",
  "system.ram_usage": "RAM Usage",
  "system.disk_usage": "Disk Usage",
  "system.throttled": "Throttle",
  "system.rail_5v": "5V Rail",
  "system.psu_max_current": "PSU Max",
}

export function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? metric
}

// Bits 0–3 of the Pi firmware throttle mask (system.throttled carries the
// current nibble; system.throttled_sticky the since-boot nibble, same legend).
const THROTTLE_BITS: Array<[number, string]> = [
  [0x1, "undervoltage"],
  [0x2, "freq capped"],
  [0x4, "throttled"],
  [0x8, "soft temp limit"],
]

/** Human-readable names of the set bits in a throttle bitmask. */
export function decodeThrottleBits(mask: number): string[] {
  return THROTTLE_BITS.filter(([bit]) => mask & bit).map(([, label]) => label)
}

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "-": "⁻",
}

// Devices publish exponents in ASCII caret form ("m/s^2"); render them as real
// superscript glyphs. Unicode rather than <sup> so the result stays a plain
// string — table headers and their CSV export take it as-is, and the glyphs are
// designed for the size instead of being a scaled-down baseline shift.
export function formatUnit(unit: string): string {
  return unit.replace(/\^(-?\d+)/g, (whole, exp: string) => {
    const sup = [...exp].map((c) => SUPERSCRIPT_DIGITS[c])
    return sup.every(Boolean) ? sup.join("") : whole
  })
}

// Canonical column order for telemetry tables: metrics known to METRIC_LABELS
// come first (in their declared order), unknown keys fall to the end sorted
// alphabetically. Used to give data-derived column sets a stable, readable order.
const METRIC_ORDER = Object.keys(METRIC_LABELS)

export function orderMetrics(keys: string[]): string[] {
  const rank = (m: string) => {
    const i = METRIC_ORDER.indexOf(m)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return [...keys].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    return ra !== rb ? ra - rb : a.localeCompare(b)
  })
}

export function formatMetricValue(value: number, metric?: string): string {
  // Coordinates need full precision — the default rounding mangles lat/lon.
  if (metric === "gps.lat" || metric === "gps.lon") return value.toFixed(6)
  // The 5V rail moves in millivolts (5.134 vs 5.089 is signal, not noise).
  if (metric === "system.rail_5v") return value.toFixed(3)
  // Quaternions are normalized (|q| = 1), so show 4 dp; euler angles 1 dp.
  if (metric?.startsWith("imu.quat_")) return value.toFixed(4)
  if (metric?.startsWith("imu.euler_")) return value.toFixed(1)
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(Math.abs(value) < 10 ? 2 : 1)
}
