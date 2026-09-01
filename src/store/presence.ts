import { useMemo } from "react"
import { create } from "zustand"
import type { Device } from "@xorgate/sdk"

/**
 * Who is publishing telemetry RIGHT NOW, fed by `<DevicePresence>` (one MQTT
 * feed per watched device) and read as an overlay at render time.
 *
 * This deliberately lives outside the query cache: the cache holds the
 * platform's answer (authoritative, and the only source that can say a device
 * went AWAY, via the broker's last-will), while this set only ever adds the
 * fast "it's back" signal. A device in here that the REST row calls offline
 * is shown online, because a frame from the device is better evidence than a
 * poll from 20 seconds ago. The overlay is never written back into the cache,
 * so the next refetch cannot fight it.
 *
 * Only membership transitions update the store, so a table showing a status
 * dot re-renders when a device appears or goes quiet, not on every frame.
 */
interface PresenceState {
  present: Set<string>
  report: (deviceId: string) => void
  drop: (deviceId: string) => void
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  present: new Set<string>(),

  report: (deviceId) => {
    if (get().present.has(deviceId)) return
    set((s) => {
      const next = new Set(s.present)
      next.add(deviceId)
      return { present: next }
    })
  },

  drop: (deviceId) => {
    if (!get().present.has(deviceId)) return
    set((s) => {
      const next = new Set(s.present)
      next.delete(deviceId)
      return { present: next }
    })
  },
}))

/**
 * Fleet rows with the presence overlay applied: a device the platform still
 * calls offline (or freshly provisioned) reads online the moment it starts
 * publishing. Decommissioned devices are left alone, and the platform's own
 * "online" is never second-guessed; going offline is the poll's job.
 */
export function useLiveDeviceStatuses(devices: Device[]): Device[] {
  const present = usePresenceStore((s) => s.present)
  return useMemo(
    () =>
      devices.map((d) =>
        d.status !== "online" &&
        d.status !== "decommissioned" &&
        present.has(d.id)
          ? { ...d, status: "online" as const }
          : d
      ),
    [devices, present]
  )
}

/** Same overlay for a single device (the detail header). */
export function useLiveDeviceStatus(device: Device | undefined) {
  const list = useMemo(() => (device ? [device] : []), [device])
  return useLiveDeviceStatuses(list)[0]
}

/**
 * Which devices are worth a live feed: anything that could plausibly start
 * (or keep) publishing. One MQTT connection per device, so callers should
 * pass the rows on screen, not the whole fleet.
 */
export function presenceDeviceIds(devices: Device[]): string[] {
  return devices.filter((d) => d.status !== "decommissioned").map((d) => d.id)
}
