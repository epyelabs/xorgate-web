import { useEffect } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { LoginForm } from "@/components/login-form"
import { XorgateLogo } from "@/components/xorgate-logo"
import { AccentField } from "@/components/accent-field"
import { useAuthStore } from "@/store/auth"
import {
  DEFAULT_AUTHED_ROUTE,
  ensureAuthInitialized,
  sanitizeRedirect,
} from "@/lib/auth-guard"

export const Route = createFileRoute("/login")({
  // `?redirect=` is set by the private-route guard so signing in resumes the
  // page the visitor originally asked for. This only types the param — the
  // router keeps the raw query string around even for keys a validator drops,
  // so sanitizeRedirect has to run again wherever the value is navigated to.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: async ({ search }) => {
    await ensureAuthInitialized()
    if (useAuthStore.getState().isAuthenticated) {
      throw redirect({
        href: sanitizeRedirect(search.redirect) ?? DEFAULT_AUTHED_ROUTE,
      })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  // The sign-out hold stays up until the login page is actually on screen.
  // Releasing it here rather than in the sign-out helper also covers the
  // guard-driven sign-out (a dead session failing /me), which redirects here
  // without going through that helper at all.
  useEffect(() => {
    useAuthStore.getState().endSignOut()
  }, [])

  return (
    <div className="relative isolate flex min-h-svh flex-col items-center justify-center gap-6 bg-shell p-6 md:p-10">
      <AccentField variant="grid-full" />
      <div className="flex w-full max-w-sm flex-col gap-6">
        <a href="/" className="self-center" aria-label="xorgate">
          <XorgateLogo className="h-7 w-auto text-brand" />
        </a>
        <LoginForm />
      </div>
    </div>
  )
}
