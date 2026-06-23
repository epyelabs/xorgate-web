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

export function formatMetricValue(value: number, metric?: string): string {
  // Coordinates need full precision — the default rounding mangles lat/lon.
  if (metric === "gps.lat" || metric === "gps.lon") return value.toFixed(6)
  // Quaternions are normalized (|q| = 1), so show 4 dp; euler angles 1 dp.
  if (metric?.startsWith("imu.quat_")) return value.toFixed(4)
  if (metric?.startsWith("imu.euler_")) return value.toFixed(1)
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(Math.abs(value) < 10 ? 2 : 1)
}
