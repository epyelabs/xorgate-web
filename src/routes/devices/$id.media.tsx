import { createFileRoute, redirect } from "@tanstack/react-router"
import { useAuthStore } from "@/store/auth"
import { DeviceSessionsCard } from "./-components/device-sessions-card"

export const Route = createFileRoute("/devices/$id/media")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DeviceMediaPage,
})

function DeviceMediaPage() {
  const { id } = Route.useParams()

  // Device-recorded sessions (offline recording plan). The cloud
  // viewer-recorder's table that used to sit above this is gone; Phase 2 of the
  // recorder-removal plan adds filters + search to this card.
  return (
    <div className="flex flex-col gap-4">
      <DeviceSessionsCard deviceId={id} />
    </div>
  )
}
