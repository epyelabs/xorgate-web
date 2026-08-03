import { createFileRoute, redirect } from "@tanstack/react-router"
import { useAuthStore } from "@/store/auth"
import { DEFAULT_AUTHED_ROUTE, ensureAuthInitialized } from "@/lib/auth-guard"

// No home/dashboard page exists yet, so `/` is a pure hub: authenticated users
// land on /devices (the default authenticated page) and everyone else on login.
// Awaiting the shared bootstrap keeps this correct on a cold load too, where
// the session is still being restored when the route is first matched.
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    await ensureAuthInitialized()
    const { isAuthenticated } = useAuthStore.getState()
    throw redirect({
      to: isAuthenticated ? DEFAULT_AUTHED_ROUTE : "/login",
      replace: true,
    })
  },
})
