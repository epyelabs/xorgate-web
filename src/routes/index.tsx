import { useEffect } from "react"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { useAuthStore } from "@/store/auth"

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading) {
      throw redirect({ to: isAuthenticated ? "/devices" : "/login" })
    }
  },
  component: IndexRedirect,
})

// No home/dashboard page exists yet, so `/` is a pure hub: authenticated users
// land on /devices (the default authenticated page) and everyone else on login.
// beforeLoad covers direct navigation once auth is known; this effect covers the
// initial load where `/` is matched while auth is still bootstrapping (isLoading).
function IndexRedirect() {
  const isLoading = useAuthStore((s) => s.isLoading)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const navigate = useNavigate()

  useEffect(() => {
    if (isLoading) return
    navigate({ to: isAuthenticated ? "/devices" : "/login", replace: true })
  }, [isLoading, isAuthenticated, navigate])

  return null
}
