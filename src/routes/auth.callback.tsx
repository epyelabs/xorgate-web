import { useEffect, useRef } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { useAuthStore } from "@/store/auth"
import { signInWithProvider } from "@/lib/cognito"
import { DEFAULT_AUTHED_ROUTE, sanitizeRedirect } from "@/lib/auth-guard"
import { AppLoadingScreen } from "@/components/app-loading-screen"

interface CallbackSearch {
  code?: string
  state?: string
  error?: string
  error_description?: string
}

// Cognito Hosted-UI redirect target for the Google sign-in round trip. No auth
// guard: the visitor is mid-login when they land here.
export const Route = createFileRoute("/auth/callback")({
  validateSearch: (search: Record<string, unknown>): CallbackSearch => ({
    code: typeof search.code === "string" ? search.code : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
    error_description:
      typeof search.error_description === "string"
        ? search.error_description
        : undefined,
  }),
  component: AuthCallbackPage,
})

// When the PreSignUp trigger links a first-time Google sign-in onto an
// existing password user, Cognito aborts that sign-in with this error AFTER
// the link succeeded. One automatic retry completes the login as the linked
// user. The flag stops a second failure from looping forever.
const LINKED_RETRY_MARKER = "already found an entry for username"
const RETRY_FLAG = "xorgate.oauthLinkRetried"

// Codes this page has already started exchanging. Module-scoped on purpose: the
// page MOUNTS MORE THAN ONCE per login. When finishOAuth flips isAuthenticated,
// the root layout swaps from the bare <Outlet /> to the app shell while the
// router is still mid-transition away from /auth/callback, so this component is
// torn down and mounted fresh with the same search params. A per-instance ref
// cannot see that; a second run would find the PKCE stash already consumed and
// bounce the user through /login with a "Missing PKCE verifier" toast.
const consumedCodes = new Set<string>()

function AuthCallbackPage() {
  const { code, state, error, error_description } = Route.useSearch()
  const navigate = useNavigate()
  const finishOAuth = useAuthStore((s) => s.finishOAuth)
  const ranRef = useRef(false)

  useEffect(() => {
    // Guard against React StrictMode's double-invoke: the auth code and PKCE
    // verifier can each only be consumed once.
    if (ranRef.current) return
    ranRef.current = true

    if (
      error &&
      error_description?.toLowerCase().includes(LINKED_RETRY_MARKER) &&
      sessionStorage.getItem(RETRY_FLAG) !== "1"
    ) {
      sessionStorage.setItem(RETRY_FLAG, "1")
      void signInWithProvider("Google")
      return
    }

    if (error || !code || !state) {
      if (error) {
        toast.error(error_description ?? `Google sign-in failed (${error})`)
      }
      navigate({ to: "/login", replace: true })
      return
    }

    // A remount mid-exchange: the first instance owns this code and will
    // navigate onward when it resolves. Do nothing here.
    if (consumedCodes.has(code)) return
    consumedCodes.add(code)

    finishOAuth(code, state)
      .then((returnTo) => {
        sessionStorage.removeItem(RETRY_FLAG)
        navigate({
          href: sanitizeRedirect(returnTo) ?? DEFAULT_AUTHED_ROUTE,
          replace: true,
        })
      })
      .catch((err: unknown) => {
        toast.error((err as Error).message)
        navigate({ to: "/login", replace: true })
      })
  }, [code, state, error, error_description, finishOAuth, navigate])

  return <AppLoadingScreen label="Signing you in" />
}
