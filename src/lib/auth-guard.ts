import { redirect } from "@tanstack/react-router"
import { useAuthStore } from "@/store/auth"

// Restoring a Cognito session is async, so a guard that read the auth store
// synchronously would wave a private page through on a hard refresh (auth still
// bootstrapping, isAuthenticated still false). Every caller awaits this one
// shared promise instead, so guards always decide against a settled session —
// and initialize() runs exactly once, including under StrictMode's double
// effect invocation.
let initPromise: Promise<void> | null = null

export function ensureAuthInitialized(): Promise<void> {
  if (!initPromise) initPromise = useAuthStore.getState().initialize()
  return initPromise
}

// Only same-origin absolute paths survive, so a crafted
// `?redirect=//evil.example` can't bounce a user off-site right after they sign
// in. Anything else is dropped and the caller falls back to its default.
export function sanitizeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  if (!value.startsWith("/") || value.startsWith("//")) return undefined
  return value
}

// Where a signed-in user lands when no specific destination was requested.
export const DEFAULT_AUTHED_ROUTE = "/devices"

// beforeLoad guard for every private route: unauthenticated visitors are sent
// to /login?redirect=<where they were headed>, so signing in resumes the trip
// instead of dumping them on the default page.
export async function requireAuth({
  location,
}: {
  location: { href: string }
}): Promise<void> {
  await ensureAuthInitialized()
  if (useAuthStore.getState().isAuthenticated) return
  throw redirect({
    to: "/login",
    search: { redirect: location.href },
    replace: true,
  })
}
