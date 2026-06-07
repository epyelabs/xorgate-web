import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { useAuthStore } from "@/store/auth"

// Layout route for /devices/$id. Renders its children (index = detail card,
// `live` = live telemetry) through the Outlet. The auth guard here protects all
// nested routes.
export const Route = createFileRoute("/devices/$id")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DeviceLayout,
})

function DeviceLayout() {
  return <Outlet />
}
