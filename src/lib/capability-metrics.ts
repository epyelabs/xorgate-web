import type { IoCapabilities } from "@/lib/api"

// Capability → metric-key helpers shared by the live and history screens
// (drives which widgets render). Extracted from $id.live.tsx in P4.

export function systemMetrics(caps: IoCapabilities | null): string[] {
  return (caps?.system?.fields ?? []).map((f) => `system.${f}`)
}

export function signalMetrics(caps: IoCapabilities | null): string[] {
  return (caps?.comm?.signal?.fields ?? []).map((f) => `lte.${f}`)
}

const GPS_ORDER = ["lat", "lon", "alt", "speed"]

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
