import { describe, it, expect, vi, beforeEach } from "vitest"
import { isRedirect } from "@tanstack/react-router"

// Mocked at the module boundary so the guard's real decision logic runs against
// a controllable /me and Cognito session, with no env vars or network needed.
const h = vi.hoisted(() => {
  const payload = Buffer.from(
    JSON.stringify({ sub: "user-1", email: "operator@example.com" })
  ).toString("base64")
  return {
    idToken: `header.${payload}.signature`,
    me: vi.fn(),
    getCurrentSession: vi.fn(),
    signOut: vi.fn(),
    listWorkspaces: vi.fn(),
  }
})

// The workspace store persists its selection to localStorage, which the node
// test environment does not have — without a stand-in every store write logs a
// zustand warning over the test output. Nothing here asserts on what is stored.
if (!("localStorage" in globalThis)) {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  })
}

vi.mock("@/lib/cognito", () => ({
  getCurrentSession: h.getCurrentSession,
  getIdToken: vi.fn(async () => h.idToken),
  signOut: h.signOut,
  signIn: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  completeNewPassword: vi.fn(),
}))

vi.mock("@/lib/account-api", () => ({
  fetchMe: h.me,
}))

// auth-guard reaches the workspace store (requireWorkspace), which registers
// its tenancy getters against this module at import time — so the mock has to
// carry them even though no test here calls the API.
vi.mock("@/lib/xorgate", () => ({
  xgMessage: (e: unknown) => String(e),
  registerOrgIdGetter: vi.fn(),
  registerWorkspaceIdGetter: vi.fn(),
  xg: vi.fn(() => ({ workspaces: { list: h.listWorkspaces } })),
  xgBootstrap: vi.fn(() => {
    throw new Error("xgBootstrap() is not stubbed for this test")
  }),
}))

const LIVE_SESSION = {
  getIdToken: () => ({ getJwtToken: () => h.idToken }),
}

const ORG = { id: "org-1", name: "Acme Robotics", slug: "acme-robotics" }
const WORKSPACE = { id: "ws-1", name: "Default", slug: "default" }

function meResponse(organizations: unknown[]) {
  return {
    user: { id: "user-1", email: "operator@example.com" },
    memberships: [],
    organizations,
  }
}

const AT = { location: { href: "/devices" } }

// beforeLoad guards signal by throwing: a redirect object for "go elsewhere",
// anything else for a genuine failure. Both are outcomes worth asserting on.
async function attempt(fn: () => Promise<void>) {
  try {
    await fn()
    return { passed: true as const, redirectTo: undefined, thrown: undefined }
  } catch (e) {
    return {
      passed: false as const,
      redirectTo: isRedirect(e) ? (e.options.to as string) : undefined,
      thrown: e as unknown,
    }
  }
}

beforeEach(() => {
  // initPromise, the /me flight and the zustand store are all module state.
  vi.resetModules()
  // The workspace store rehydrates its persisted selection on import, so a
  // leftover organization id would survive resetModules and pre-answer the
  // very question these tests are asking.
  localStorage.clear()
  h.me.mockReset()
  h.getCurrentSession.mockReset()
  h.signOut.mockReset()
  h.listWorkspaces.mockReset()
})

describe("requireAuth organization check", () => {
  it("passes a user who has an organization straight through", async () => {
    h.getCurrentSession.mockResolvedValue(LIVE_SESSION)
    h.me.mockResolvedValue(meResponse([ORG]))

    const { requireAuth } = await import("@/lib/auth-guard")
    expect((await attempt(() => requireAuth(AT))).passed).toBe(true)
  })

  it("still sends a genuinely org-less user to onboarding", async () => {
    h.getCurrentSession.mockResolvedValue(LIVE_SESSION)
    h.me.mockResolvedValue(meResponse([]))

    const { requireAuth } = await import("@/lib/auth-guard")
    const result = await attempt(() => requireAuth(AT))
    expect(result.redirectTo).toBe("/onboarding")
  })

  // The regression. A failed /me leaves `organizations` empty, which used to be
  // read as "this user has no organization" and redirected them to a form
  // inviting them to create a duplicate one.
  it("does NOT redirect to onboarding when /me fails", async () => {
    h.getCurrentSession.mockResolvedValue(LIVE_SESSION)
    h.me.mockRejectedValue(new Error("NETWORK GET /v1/me: fetch failed"))

    const { requireAuth } = await import("@/lib/auth-guard")
    const result = await attempt(() => requireAuth(AT))

    expect(result.redirectTo).toBeUndefined()
    expect(result.thrown).toBeInstanceOf(Error)
    expect((result.thrown as Error).message).toContain("fetch failed")
  })

  // The stickiness half: initialize() swallowed the failure and nothing ever
  // retried, so the empty array outlived the blip for the whole tab.
  it("retries /me after a failed bootstrap instead of onboarding", async () => {
    h.getCurrentSession.mockResolvedValue(LIVE_SESSION)
    h.me
      .mockRejectedValueOnce(new Error("cold start timeout"))
      .mockResolvedValue(meResponse([ORG]))

    const { requireAuth } = await import("@/lib/auth-guard")
    const result = await attempt(() => requireAuth(AT))

    expect(result.passed).toBe(true)
    expect(h.me).toHaveBeenCalledTimes(2)
  })

  it("sends the user to login when the Cognito session is gone", async () => {
    h.getCurrentSession
      .mockResolvedValueOnce(LIVE_SESSION)
      .mockResolvedValue(null)
    h.me.mockRejectedValue(new Error("UNAUTHORIZED GET /v1/me"))

    const { requireAuth } = await import("@/lib/auth-guard")
    const result = await attempt(() => requireAuth(AT))

    expect(result.redirectTo).toBe("/login")
    expect(h.signOut).toHaveBeenCalled()
  })

  it("coalesces concurrent guards onto a single /me", async () => {
    h.getCurrentSession.mockResolvedValue(LIVE_SESSION)
    h.me
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValue(meResponse([ORG]))

    const { requireAuth } = await import("@/lib/auth-guard")
    const results = await Promise.all([
      attempt(() => requireAuth(AT)),
      attempt(() => requireAuth(AT)),
      attempt(() => requireAuth(AT)),
    ])

    expect(results.every((r) => r.passed)).toBe(true)
    // One failed bootstrap call plus one shared retry — not one per guard.
    expect(h.me).toHaveBeenCalledTimes(2)
  })
})

describe("/onboarding bounce-back", () => {
  it("does not strand a user on the form when /me has not answered yet", async () => {
    h.getCurrentSession.mockResolvedValue(LIVE_SESSION)
    h.me
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValue(meResponse([ORG]))

    // What the route's beforeLoad does: authenticate, then insist on a real
    // profile before trusting `organizations`.
    const { requireAuthOnly, requireProfile } = await import("@/lib/auth-guard")
    const { useAuthStore } = await import("@/store/auth")

    await requireAuthOnly({ location: { href: "/onboarding" } })
    await requireProfile({ location: { href: "/onboarding" } })

    expect(useAuthStore.getState().organizations).toHaveLength(1)
  })
})

describe("requireWorkspace", () => {
  it("passes a user whose organization has a workspace", async () => {
    h.getCurrentSession.mockResolvedValue(LIVE_SESSION)
    h.me.mockResolvedValue(meResponse([ORG]))
    h.listWorkspaces.mockResolvedValue([WORKSPACE])

    const { requireWorkspace } = await import("@/lib/auth-guard")
    expect((await attempt(() => requireWorkspace(AT))).passed).toBe(true)
  })

  it("sends a user whose organization has no workspace to /no-workspace", async () => {
    h.getCurrentSession.mockResolvedValue(LIVE_SESSION)
    h.me.mockResolvedValue(meResponse([ORG]))
    h.listWorkspaces.mockResolvedValue([])

    const { requireWorkspace } = await import("@/lib/auth-guard")
    const result = await attempt(() => requireWorkspace(AT))

    expect(result.redirectTo).toBe("/no-workspace")
  })

  // Same shape as the /me regression above: a failed list is byte-for-byte an
  // organization with no workspaces, and treating the two alike would lock a
  // user out of their own devices on a network blip.
  it("does NOT redirect to /no-workspace when the workspace list fails", async () => {
    h.getCurrentSession.mockResolvedValue(LIVE_SESSION)
    h.me.mockResolvedValue(meResponse([ORG]))
    h.listWorkspaces.mockRejectedValue(new Error("NETWORK GET /v1/workspaces"))

    const { requireWorkspace } = await import("@/lib/auth-guard")
    const result = await attempt(() => requireWorkspace(AT))

    expect(result.redirectTo).toBeUndefined()
    expect(result.thrown).toBeInstanceOf(Error)
  })

  it("still sends an org-less user to onboarding rather than /no-workspace", async () => {
    h.getCurrentSession.mockResolvedValue(LIVE_SESSION)
    h.me.mockResolvedValue(meResponse([]))

    const { requireWorkspace } = await import("@/lib/auth-guard")
    const result = await attempt(() => requireWorkspace(AT))

    expect(result.redirectTo).toBe("/onboarding")
    expect(h.listWorkspaces).not.toHaveBeenCalled()
  })

  // The guard and the auth-store subscriber both reach for the list in the
  // same tick on a cold boot; without the shared flight that is two requests,
  // and the second could answer first and publish a stale list.
  it("shares one workspace fetch across concurrent guards", async () => {
    h.getCurrentSession.mockResolvedValue(LIVE_SESSION)
    h.me.mockResolvedValue(meResponse([ORG]))
    h.listWorkspaces.mockResolvedValue([WORKSPACE])

    const { requireWorkspace } = await import("@/lib/auth-guard")
    const results = await Promise.all([
      attempt(() => requireWorkspace(AT)),
      attempt(() => requireWorkspace(AT)),
      attempt(() => requireWorkspace(AT)),
    ])

    expect(results.every((r) => r.passed)).toBe(true)
    expect(h.listWorkspaces).toHaveBeenCalledTimes(1)
  })
})
