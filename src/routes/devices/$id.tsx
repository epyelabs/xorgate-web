import { useEffect } from "react"
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { useAuthStore } from "@/store/auth"
import { useBreadcrumbStore } from "@/store/breadcrumb"

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
  const { id } = Route.useParams()

  // The child pages publish the device name once it loads; clear it when
  // leaving the device (or switching to a different one) so the breadcrumb
  // never shows a stale name.
  useEffect(() => {
    return () => {
      useBreadcrumbStore.getState().setDeviceName(null)
    }
  }, [id])

  return <Outlet />
}
