import { create } from "zustand"
import {
  signIn,
  signUp,
  confirmSignUp,
  signOut,
  getCurrentSession,
  completeNewPassword as cognitoCompleteNewPassword,
  completeOAuthLogin,
} from "@/lib/cognito"
import { fetchMe, type AccountUser } from "@/lib/account-api"
import type { Membership, Organization } from "@xorgate/sdk"

// login() resolves to "newPasswordRequired" when an admin-created invitee signs
// in with their temporary password and must set a new one before continuing.
export type LoginResult = { status: "ok" } | { status: "newPasswordRequired" }

interface AuthState {
  user: AccountUser | null
  memberships: Membership[]
  organizations: Organization[]
  isLoading: boolean
  isAuthenticated: boolean
  // Whether /me has actually answered. `organizations` carries no meaning
  // until it has: an empty array means "this user has none" ONLY when this is
  // true, and "we don't know yet" when it is false. Read them together.
  profileLoaded: boolean
  error: string | null

  initialize: () => Promise<void>
  ensureProfile: () => Promise<void>
  login: (email: string, password: string) => Promise<LoginResult>
  completeNewPassword: (newPassword: string) => Promise<void>
  // Finishes a Hosted-UI (Google) round trip from the `code`/`state` Cognito
  // sent to /auth/callback. Resolves to the same-origin path the visitor was
  // headed for before signing in, if one was remembered.
  finishOAuth: (code: string, state: string) => Promise<string | undefined>
  signup: (email: string, password: string) => Promise<void>
  confirmSignup: (email: string, code: string) => Promise<void>
  logout: () => void
  refreshMe: () => Promise<void>
  // Writes a profile back after the account screen changes it, so the sidebar
  // and its dropdown show the new name or picture in the same frame — the
  // profile endpoints all answer with the updated user, so there is nothing
  // to re-fetch.
  applyUser: (user: AccountUser) => void
  clearError: () => void
}

interface IdTokenPayload {
  sub: string
  email: string
}

function decodeIdToken(token: string): IdTokenPayload {
  const payload = JSON.parse(atob(token.split(".")[1]))
  return { sub: payload.sub, email: payload.email }
}

async function hydrateFromMe(set: (partial: Partial<AuthState>) => void) {
  // `GET /me` needs no organization selected, which is exactly this call's
  // situation on first sign-in. It is the one read in the app that does NOT go
  // through `@xorgate/sdk`: the published client's user normalizer drops
  // `avatarUrl`, so the profile picture cannot reach the app through it (see
  // lib/account-api.ts). Everything else still runs on the SDK.
  const me = await fetchMe()
  set({
    user: me.user,
    memberships: me.memberships,
    organizations: me.organizations,
    profileLoaded: true,
  })
}

// One in-flight /me at a time. Several route guards can resolve in the same
// tick, and without this each would fire its own request — and a retry storm on
// a flaky API is exactly the condition that made the original bug show up.
let profileFlight: Promise<void> | null = null

function fetchProfile(
  set: (partial: Partial<AuthState>) => void
): Promise<void> {
  if (!profileFlight) {
    profileFlight = hydrateFromMe(set).finally(() => {
      profileFlight = null
    })
  }
  return profileFlight
}

// Marks the session authenticated from a fresh id token, then best-effort
// hydrates the full profile from /me. Shared by login + completeNewPassword.
async function applyIdToken(
  idToken: string,
  set: (partial: Partial<AuthState>) => void
) {
  const claims = decodeIdToken(idToken)
  set({
    user: {
      id: claims.sub,
      email: claims.email,
      name: null,
      avatarUrl: null,
      tier: "free",
      role: "user",
      createdAt: null,
    },
    isAuthenticated: true,
  })
  try {
    await fetchProfile(set)
  } catch {
    // Proceed even if /me isn't reachable yet; token claims carry the basics.
    // profileLoaded stays false, so the route guards retry rather than reading
    // the empty `organizations` as "this user needs onboarding".
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  memberships: [],
  organizations: [],
  isLoading: true,
  isAuthenticated: false,
  profileLoaded: false,
  error: null,

  initialize: async () => {
    try {
      const session = await getCurrentSession()
      if (!session) {
        set({ isLoading: false })
        return
      }
      const claims = decodeIdToken(session.getIdToken().getJwtToken())
      set({
        user: {
          id: claims.sub,
          email: claims.email,
          name: null,
          avatarUrl: null,
          tier: "free",
          role: "user",
          createdAt: null,
        },
        isAuthenticated: true,
        isLoading: false,
      })
      try {
        await fetchProfile(set)
      } catch {
        // Best-effort: boot must not block on /me. profileLoaded stays false
        // and ensureProfile() retries from the first guard that needs it.
      }
    } catch {
      set({ isLoading: false })
    }
  },

  // Guarantees `organizations` is trustworthy, or throws. Cheap once loaded,
  // so guards can call it on every navigation.
  ensureProfile: async () => {
    if (!get().isAuthenticated) return
    if (get().profileLoaded) return
    await fetchProfile(set)
  },

  login: async (email, password) => {
    set({ error: null })
    try {
      const result = await signIn(email, password)
      if (result.challenge === "NEW_PASSWORD_REQUIRED") {
        // Invitee's first sign-in: they must set a password before we have a
        // session. The login form routes to the set-password step.
        return { status: "newPasswordRequired" }
      }
      await applyIdToken(result.session.getIdToken().getJwtToken(), set)
      return { status: "ok" }
    } catch (err) {
      set({ error: (err as Error).message })
      throw err
    }
  },

  completeNewPassword: async (newPassword) => {
    set({ error: null })
    try {
      const session = await cognitoCompleteNewPassword(newPassword)
      await applyIdToken(session.getIdToken().getJwtToken(), set)
    } catch (err) {
      set({ error: (err as Error).message })
      throw err
    }
  },

  finishOAuth: async (code, state) => {
    set({ error: null })
    try {
      const { session, returnTo } = await completeOAuthLogin(code, state)
      await applyIdToken(session.getIdToken().getJwtToken(), set)
      return returnTo
    } catch (err) {
      set({ error: (err as Error).message })
      throw err
    }
  },

  signup: async (email, password) => {
    set({ error: null })
    try {
      await signUp(email, password)
    } catch (err) {
      set({ error: (err as Error).message })
      throw err
    }
  },

  confirmSignup: async (email, code) => {
    set({ error: null })
    try {
      await confirmSignUp(email, code)
    } catch (err) {
      set({ error: (err as Error).message })
      throw err
    }
  },

  logout: () => {
    signOut()
    set({
      user: null,
      memberships: [],
      organizations: [],
      isAuthenticated: false,
      profileLoaded: false,
    })
  },

  refreshMe: async () => {
    if (!get().isAuthenticated) return
    await hydrateFromMe(set)
  },

  applyUser: (user) => set({ user }),

  clearError: () => set({ error: null }),
}))
