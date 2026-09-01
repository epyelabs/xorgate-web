import { useEffect } from "react"
import { useLiveTelemetry } from "@xorgate/react"
import { LIVE_PRESENCE_TTL_MS } from "@/lib/freshness"
import { usePresenceStore } from "@/store/presence"

// One live feed per watched device, lifted into the presence store. The SDK
// ref-counts one MQTT socket per device at module scope, so a device whose
// feed a tab already holds (e.g. the device layout's alerts feed) costs
// nothing extra here.
function DeviceFeed({ deviceId }: { deviceId: string }) {
  const { receivedAt } = useLiveTelemetry(deviceId)

  useEffect(() => {
    if (receivedAt === null) return
    usePresenceStore.getState().report(deviceId)
    // A device that stops publishing must stop driving the screen. The timer
    // is armed off the frame's OWN arrival time, so a snapshot the SDK held
    // through a hidden tab expires immediately rather than a full TTL from
    // now.
    const timer = setTimeout(
      () => usePresenceStore.getState().drop(deviceId),
      Math.max(0, receivedAt + LIVE_PRESENCE_TTL_MS - Date.now())
    )
    return () => clearTimeout(timer)
  }, [deviceId, receivedAt])

  // Unmounting a feed forgets its presence: nothing is left to keep it fresh.
  useEffect(() => () => usePresenceStore.getState().drop(deviceId), [deviceId])

  return null
}

/**
 * Mount one of these per screen that shows live status, handing it the device
 * ids on screen (see `presenceDeviceIds`). Renders nothing; it only keeps the
 * presence store current while the screen is visible.
 */
export function DevicePresence({ deviceIds }: { deviceIds: string[] }) {
  return (
    <>
      {deviceIds.map((id) => (
        <DeviceFeed key={id} deviceId={id} />
      ))}
    </>
  )
}
