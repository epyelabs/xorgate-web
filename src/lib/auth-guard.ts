import { redirect } from "@tanstack/react-router"
import { getCurrentSession } from "@/lib/cognito"
import { useAuthStore } from "@/store/auth"

// Restoring a Cognito session is async, so a guard that read the auth store
// synchronously would wave a private page through on a hard refresh (auth still
// bootstrapping, isAuthenticated still false). Every caller awaits this one
// shared promise instead, so guards always decide against a settled session —
// and initialize() runs exactly once, including under StrictMode's double
// effect invocation.
let initPromise: Promise<void> | null = null

export function ensureAuthInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = useAuthStore
      .getState()
      .initialize()
      .catch((err: unknown) => {
        // Never let one failed bootstrap poison every later navigation in this
        // tab: drop the memo so the next guard starts over.
        initPromise = null
        throw err
      })
  }
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

// Where a signed-in user with no organization is sent instead.
export const ONBOARDING_ROUTE = "/onboarding"

// beforeLoad guard for /onboarding, and the shared half of requireAuth:
// authentication only, with NO organization requirement. Onboarding must use
// this one rather than requireAuth, or the org check below would bounce the
// page against itself forever.
export async function requireAuthOnly({
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

// beforeLoad guard for every private route: unauthenticated visitors are sent
// to /login?redirect=<where they were headed>, so signing in resumes the trip
// instead of dumping them on the default page.
//
// Signed-in users with no organization are sent to /onboarding. Without this a
// fresh signup landed on /devices and every org-scoped call answered
// `403 NO_ORGANIZATION`, which surfaced as a bare error screen with no way
// forward: the only route to creating an organization was the sidebar's
// organization switcher, which is not a place a new user thinks to look.
// Checking here rather than per route means the 36 existing `requireAuth`
// call sites are covered without touching any of them.
export async function requireAuth(opts: {
  location: { href: string }
}): Promise<void> {
  await requireAuthOnly(opts)
  await requireProfile(opts)
  if (useAuthStore.getState().organizations.length > 0) return
  throw redirect({ to: ONBOARDING_ROUTE, replace: true })
}

// Makes `organizations` safe to branch on, and is the whole reason onboarding
// stopped appearing at random for users who already had an organization.
//
// initialize() marks the session authenticated from the id token's claims and
// then hydrates /me best-effort. When that call failed — a token refresh landing
// mid-flight, a cold API, a laptop waking up — the failure was swallowed and
// `organizations` stayed `[]`, which is byte-for-byte what a genuinely org-less
// user looks like. requireAuth read it and redirected. Worse, nothing retried:
// the empty array persisted for the tab's lifetime, so every subsequent
// navigation redirected too, and /onboarding's own "already onboarded" bounce
// read the same stale array and kept the user there. The visible result was an
// already-onboarded user being invited to create a DUPLICATE organization.
//
// So the array is only ever read after /me has actually answered. If it cannot,
// we say so rather than guessing — an error screen with a retry is recoverable,
// a spurious onboarding form is not.
export async function requireProfile(opts: {
  location: { href: string }
}): Promise<void> {
  try {
    await useAuthStore.getState().ensureProfile()
  } catch (err) {
    // A dead session fails /me exactly like a flaky network does, but it has a
    // real destination. Ask Cognito directly: no session means the refresh
    // token is gone, and the correct screen is the login page, not an error the
    // user can only retry into the same wall.
    if ((await getCurrentSession()) === null) {
      useAuthStore.getState().logout()
      throw redirect({
        to: "/login",
        search: { redirect: opts.location.href },
        replace: true,
      })
    }
    throw err
  }
}
