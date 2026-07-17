import type { IoCapabilities } from "@/lib/api"

// Capability → metric-key helpers shared by the live and history screens
// (drives which widgets render). Extracted from $id.live.tsx in P4.

export function systemMetrics(caps: IoCapabilities | null): string[] {
  return (caps?.system?.fields ?? []).map((f) => `system.${f}`)
}

export function signalMetrics(caps: IoCapabilities | null): string[] {
  return (caps?.comm?.signal?.fields ?? []).map((f) => `lte.${f}`)
}

const GPS_ORDER = ["lat", "lon", "alt", "speed", "course", "satellites", "fix_quality", "satellites_in_view", "hdop"]

export function gpsMetrics(caps: IoCapabilities | null): string[] {
  const fields = caps?.comm?.gps?.fields ?? []
  return GPS_ORDER.filter((f) => fields.includes(f)).map((f) => `gps.${f}`)
}

// IMU (BNO085) sub-groups. The agent publishes prefixed metric keys:
// imu.accel_{x,y,z}, imu.quat_{r,i,j,k}, imu.euler_{roll,pitch,yaw}.
export function imuAccelMetrics(caps: IoCapabilities | null): string[] {
  // `accel` is the current field; `axes` is the legacy alias kept for old models.
  const accel = caps?.sensors?.imu?.accel ?? caps?.sensors?.imu?.axes
  if (!accel || accel.length === 0) return []
  return accel.map((a) => `imu.accel_${a}`)
}

export function imuQuaternionMetrics(caps: IoCapabilities | null): string[] {
  const quat = caps?.sensors?.imu?.quaternion
  if (!quat || quat.length === 0) return []
  return quat.map((q) => `imu.quat_${q}`)
}

export function imuEulerMetrics(caps: IoCapabilities | null): string[] {
  const euler = caps?.sensors?.imu?.euler
  if (!euler || euler.length === 0) return []
  return euler.map((e) => `imu.euler_${e}`)
}

/** All IMU metrics in display order (accel, then orientation), for history views. */
export function imuMetrics(caps: IoCapabilities | null): string[] {
  return [
    ...imuAccelMetrics(caps),
    ...imuQuaternionMetrics(caps),
    ...imuEulerMetrics(caps),
  ]
}

export function systemChartMetrics(caps: IoCapabilities | null): string[] {
  return (caps?.system?.fields ?? [])
    .filter((f) => f === "cpu_usage" || f === "ram_usage" || f === "cpu_temp" || f === "disk_usage")
    .map((f) => `system.${f}`)
}

// --- Workflow capability compatibility ---------------------------------------
// Every telemetry metric key a device model can produce (used by the workflow
// attach picker + trigger condition editor). Mirrors the backend
// services/workflow-capabilities.ts producibleMetricKeys().
export function producibleMetricKeys(caps: IoCapabilities | null): Set<string> {
  return new Set([
    ...gpsMetrics(caps),
    ...imuMetrics(caps),
    ...signalMetrics(caps),
    ...systemMetrics(caps),
  ])
}

// All telemetry metrics offered by a device, in display order — drives the
// telemetry_condition metric picker in the attach sheet.
export function telemetryMetricOptions(caps: IoCapabilities | null): string[] {
  return [
    ...gpsMetrics(caps),
    ...imuMetrics(caps),
    ...signalMetrics(caps),
    ...systemMetrics(caps),
  ]
}

function hasVideo(caps: IoCapabilities | null): boolean {
  return (caps?.media?.video?.length ?? 0) > 0
}

// Required capability tokens ("video" | "gps" | "imu" | "metric:<key>") a device
// model cannot satisfy. Empty => the template is compatible. The server still
// enforces this authoritatively on attach.
export function missingCapabilities(
  required: string[] | undefined,
  caps: IoCapabilities | null,
): string[] {
  if (!required || required.length === 0) return []
  const keys = producibleMetricKeys(caps)
  return required.filter((token) => {
    if (token === "video") return !hasVideo(caps)
    if (token === "gps") return gpsMetrics(caps).length === 0
    if (token === "imu") return imuMetrics(caps).length === 0
    if (token.startsWith("metric:")) return !keys.has(token.slice("metric:".length))
    return false
  })
}
