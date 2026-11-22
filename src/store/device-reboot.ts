import { create } from "zustand"

// When Reboot Device was last asked of each device, in this browser session.
//
// The command is fire-and-forget and lives in the device layout's header; the
// cards that wait on its outcome (a camera line or a rotation written to the
// boot config, "REBOOT REQUIRED") live in the Settings tab below it. This is
// the one fact the two share: the settings hook re-reads the device for a
// bounded time after a reboot was asked, so "Reboot Device, then the card
// shows the camera detected" needs no reload.

interface DeviceRebootState {
  /** Device id -> epoch ms of the last accepted reboot command. */
  requestedAt: Record<string, number>
  markRequested: (deviceId: string, at?: number) => void
}

export const useDeviceRebootStore = create<DeviceRebootState>()((set) => ({
  requestedAt: {},
  markRequested: (deviceId, at = Date.now()) =>
    set((state) => ({ requestedAt: { ...state.requestedAt, [deviceId]: at } })),
}))
