import { create } from "zustand"

// Lets device pages publish the fetched device's display name so the root
// layout breadcrumb can render "Home > Devices > DEVICE_NAME" without
// refetching the device.
interface BreadcrumbState {
  deviceName: string | null
  setDeviceName: (deviceName: string | null) => void
}

export const useBreadcrumbStore = create<BreadcrumbState>((set) => ({
  deviceName: null,
  setDeviceName: (deviceName) => set({ deviceName }),
}))
