import type { IoCapabilities } from "@/lib/api"

// Capability → metric-key helpers shared by the live and history screens
// (drives which widgets render). Extracted from $id.live.tsx in P4.

export function gaugeMetrics(caps: IoCapabilities | null): string[] {
  if (!caps) return []
  const m: string[] = []
  for (const f of caps.system?.fields ?? []) m.push(`system.${f}`)
  for (const f of caps.comm?.signal?.fields ?? []) m.push(`lte.${f}`)
  const gps = caps.comm?.gps?.fields ?? []
  if (gps.includes("speed")) m.push("gps.speed")
  if (gps.includes("alt")) m.push("gps.alt")
  return m
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
