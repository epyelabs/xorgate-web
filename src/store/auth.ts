import { create } from "zustand"
import {
  signIn,
  signUp,
  confirmSignUp,
  signOut,
  getCurrentSession,
} from "@/lib/cognito"
import {
  getMe,
  type MeUser,
  type Membership,
  type Organization,
} from "@/lib/api"

interface AuthState {
  user: MeUser | null
  memberships: Membership[]
  organizations: Organization[]
  isLoading: boolean
  isAuthenticated: boolean
  error: string | null

  initialize: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
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
      const session = await signIn(email, password)
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
      })
      try {
        await hydrateFromMe(set)
      } catch {
        // proceed even if /me fails immediately after login
      }
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
