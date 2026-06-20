// Friendly labels for the `<group>.<field>` telemetry metric keys.
export const METRIC_LABELS: Record<string, string> = {
  "imu.x": "IMU X",
  "imu.y": "IMU Y",
  "imu.z": "IMU Z",
  "gps.lat": "Latitude",
  "gps.lon": "Longitude",
  "gps.alt": "Altitude",
  "gps.speed": "Speed",
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
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(Math.abs(value) < 10 ? 2 : 1)
}
