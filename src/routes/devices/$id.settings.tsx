import { createFileRoute, redirect } from "@tanstack/react-router"
import { useAuthStore } from "@/store/auth"
import { TabPlaceholder } from "./-components/tab-placeholder"

export const Route = createFileRoute("/devices/$id/settings")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DeviceSettingsPage,
})

function DeviceSettingsPage() {
  return <TabPlaceholder title="Settings" />
}
