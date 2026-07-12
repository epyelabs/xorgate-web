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
  "gps.satellites": "Satellites",
  "gps.fix_quality": "Fix Quality",
  "gps.satellites_in_view": "Sats in View",
  "gps.hdop": "HDOP",
  "lte.rssi": "LTE RSSI",
  "lte.quality": "LTE Quality",
  "system.cpu_usage": "CPU Usage",
  "system.cpu_temp": "CPU Temp",
  "system.ram_usage": "RAM Usage",
  "system.disk_usage": "Disk Usage",
}

export function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? metric
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
  // Quaternions are normalized (|q| = 1), so show 4 dp; euler angles 1 dp.
  if (metric?.startsWith("imu.quat_")) return value.toFixed(4)
  if (metric?.startsWith("imu.euler_")) return value.toFixed(1)
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(Math.abs(value) < 10 ? 2 : 1)
}
