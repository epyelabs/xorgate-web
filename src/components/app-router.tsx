import { RouterProvider, type AnyRouter } from "@tanstack/react-router"
import { AppLoadingScreen } from "@/components/app-loading-screen"
import { useAuthStore } from "@/store/auth"

/**
 * The router plus the sign-out hold.
 *
 * Signing out clears the query cache under a page that is still mounted, so
 * every list on it snaps back to its skeleton; on the Hosted-UI path that
 * gutted page then sits there for the whole redirect. The hold covers it, as
 * an overlay rather than by unmounting the router, so the hop to /login
 * underneath still runs on the same router instance. LoginPage drops it once
 * it is on screen.
 */
export function AppRouter({ router }: { router: AnyRouter }) {
  const signingOut = useAuthStore((s) => s.signingOut)
  return (
    <>
      <RouterProvider router={router} />
      {signingOut && (
        <AppLoadingScreen
          label="Signing you out"
          className="fixed inset-0 z-50"
        />
      )}
    </>
  )
}
