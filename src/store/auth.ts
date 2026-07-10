import { create } from "zustand"
import {
  signIn,
  signUp,
  confirmSignUp,
  signOut,
  getCurrentSession,
  completeNewPassword as cognitoCompleteNewPassword,
} from "@/lib/cognito"
import {
  getMe,
  type MeUser,
  type Membership,
  type Organization,
} from "@/lib/api"

// login() resolves to "newPasswordRequired" when an admin-created invitee signs
// in with their temporary password and must set a new one before continuing.
export type LoginResult = { status: "ok" } | { status: "newPasswordRequired" }

interface AuthState {
  user: MeUser | null
  memberships: Membership[]
  organizations: Organization[]
  isLoading: boolean
  isAuthenticated: boolean
  error: string | null

  initialize: () => Promise<void>
  login: (email: string, password: string) => Promise<LoginResult>
  completeNewPassword: (newPassword: string) => Promise<void>
  signup: (email: string, password: string) => Promise<void>
  confirmSignup: (email: string, code: string) => Promise<void>
  logout: () => void
  refreshMe: () => Promise<void>
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
  const me = await getMe()
  set({
    user: me.user,
    memberships: me.memberships,
    organizations: me.organizations,
  })
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
      tier: "free",
      role: "user",
    },
    isAuthenticated: true,
  })
  try {
    await hydrateFromMe(set)
  } catch {
    // proceed even if /me isn't reachable yet; token claims carry the basics
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  memberships: [],
  organizations: [],
  isLoading: true,
  isAuthenticated: false,
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
          tier: "free",
          role: "user",
        },
        isAuthenticated: true,
        isLoading: false,
      })
      try {
        await hydrateFromMe(set)
      } catch {
        // best-effort; UI shows whatever is in the token until /me is reachable
      }
    } catch {
      set({ isLoading: false })
    }
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
    })
  },

  refreshMe: async () => {
    if (!get().isAuthenticated) return
    await hydrateFromMe(set)
  },

  clearError: () => set({ error: null }),
}))
