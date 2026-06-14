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

export function imuMetrics(caps: IoCapabilities | null): string[] {
  const axes = caps?.sensors?.imu?.axes
  if (!axes || axes.length === 0) return []
  return axes.map((a) => `imu.${a}`)
}

export function systemChartMetrics(caps: IoCapabilities | null): string[] {
  return (caps?.system?.fields ?? [])
    .filter((f) => f === "cpu_usage" || f === "ram_usage" || f === "cpu_temp")
    .map((f) => `system.${f}`)
}
