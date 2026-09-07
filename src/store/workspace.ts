import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import {
  registerOrgIdGetter,
  registerWorkspaceIdGetter,
  xg,
  xgBootstrap,
} from "@/lib/xorgate"
import type { Organization } from "@xorgate/sdk"
import type { BrandedWorkspace } from "@/lib/branding-api"
import { useAuthStore } from "@/store/auth"
import { queryClient } from "@/lib/query-client"
import { qk } from "@/queries/keys"

interface WorkspaceState {
  currentOrganizationId: string | null
  currentWorkspaceId: string | null
  workspaces: BrandedWorkspace[]
  isLoadingWorkspaces: boolean
  // The organization `workspaces` actually reflects, or null when no list has
  // landed for the current one yet. `workspaces: []` carries no meaning on its
  // own — it is equally "this organization has none" and "we have not asked" —
  // exactly the trap that made org-less users flap through onboarding, so read
  // the two together (see requireWorkspace in lib/auth-guard.ts).
  workspacesLoadedFor: string | null

  initialize: () => Promise<void>
  setCurrentOrganization: (orgId: string) => Promise<void>
  setCurrentWorkspace: (workspaceId: string) => void
  loadWorkspaces: () => Promise<void>
  /**
   * Guarantees `workspaces` is trustworthy for the active organization, or
   * throws. Cheap once loaded, so route guards can call it on every
   * navigation. A no-op when no organization is selected: requireAuth has
   * already sent that user to onboarding.
   */
  ensureWorkspaces: () => Promise<void>
  createOrganization: (input: { name: string; slug: string }) => Promise<Organization>
  createWorkspace: (input: {
    name: string
    slug: string
    description?: string
  }) => Promise<BrandedWorkspace>
  updateWorkspace: (
    id: string,
    input: { name?: string; slug?: string; description?: string | null }
  ) => Promise<BrandedWorkspace>
  // Writes a workspace back after a logo upload changes it, so the switcher
  // and the settings table show the new mark in the same frame — the logo
  // routes answer with the updated row, so there is nothing to re-fetch.
  applyWorkspace: (workspace: BrandedWorkspace) => void
  deleteWorkspace: (id: string) => Promise<void>
  /**
   * Destroy the CURRENT organization. The API tears down every workspace and
   * device under it; here the org's cached queries go, then /me is refetched
   * and the auth-store subscriber below re-initializes the selection onto the
   * next organization (or none).
   */
  deleteOrganization: (id: string) => Promise<void>
  reset: () => void
}

// The workspace list fetch currently in flight, and the organization it is
// for. Module scope rather than store state: it is plumbing, not something a
// component should ever render off.
let flight: { orgId: string; promise: Promise<void> } | null = null

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      currentOrganizationId: null,
      currentWorkspaceId: null,
      workspaces: [],
      isLoadingWorkspaces: false,
      workspacesLoadedFor: null,

      initialize: async () => {
        const orgs = useAuthStore.getState().organizations
        const persisted = get().currentOrganizationId
        const validPersisted =
          persisted && orgs.some((o) => o.id === persisted) ? persisted : null
        const nextOrgId = validPersisted ?? orgs[0]?.id ?? null

        if (nextOrgId !== get().currentOrganizationId) {
          set({
            currentOrganizationId: nextOrgId,
            currentWorkspaceId: null,
            workspaces: [],
            workspacesLoadedFor: null,
          })
        }

        if (nextOrgId) {
          await get().loadWorkspaces()
        }
      },

      setCurrentOrganization: async (orgId) => {
        if (orgId === get().currentOrganizationId) return
        set({
          currentOrganizationId: orgId,
          currentWorkspaceId: null,
          workspaces: [],
          workspacesLoadedFor: null,
        })
        await get().loadWorkspaces()
      },

      setCurrentWorkspace: (workspaceId) => {
        set({ currentWorkspaceId: workspaceId })
      },

      loadWorkspaces: async () => {
        const orgId = get().currentOrganizationId
        if (!orgId) {
          set({
            workspaces: [],
            workspacesLoadedFor: null,
            isLoadingWorkspaces: false,
          })
          return
        }
        // Share one fetch per organization: the auth-store subscriber and a
        // route guard both reach for this in the same tick on a cold boot, and
        // the guard has to wait on the load the subscriber already started
        // rather than race a second one against it.
        if (flight && flight.orgId === orgId) return flight.promise
        const promise = (async () => {
          set({ isLoadingWorkspaces: true })
          try {
            // The SDK unwraps this envelope verbatim, so `logoUrl` really is on
            // the rows even though its published `Workspace` type predates it.
            const workspaces = (await xg().workspaces.list()) as BrandedWorkspace[]
            // The organization can change while this is in flight (a fast
            // switch); the answer belongs to the org that asked for it, so drop
            // it rather than publish another organization's list.
            if (get().currentOrganizationId !== orgId) return
            const persistedWorkspaceId = get().currentWorkspaceId
            const stillValid =
              persistedWorkspaceId && workspaces.some((p) => p.id === persistedWorkspaceId)
            const nextWorkspaceId = stillValid
              ? persistedWorkspaceId
              : workspaces[0]?.id ?? null
            set({
              workspaces,
              currentWorkspaceId: nextWorkspaceId,
              workspacesLoadedFor: orgId,
              isLoadingWorkspaces: false,
            })
          } catch {
            // Deliberately NOT marked loaded: a failed list is byte-for-byte
            // an organization with no workspaces, and treating the two alike
            // would lock a user out of their own devices until a reload.
            if (get().currentOrganizationId !== orgId) return
            set({ workspaces: [], isLoadingWorkspaces: false })
          }
        })().finally(() => {
          if (flight?.orgId === orgId) flight = null
        })
        flight = { orgId, promise }
        return promise
      },

      ensureWorkspaces: async () => {
        const orgId = get().currentOrganizationId
        if (!orgId) return
        if (get().workspacesLoadedFor === orgId) return
        await get().loadWorkspaces()
        if (get().workspacesLoadedFor !== get().currentOrganizationId) {
          throw new Error("Could not load this organization's workspaces")
        }
      },

      createOrganization: async (input) => {
        // Bootstrap client: org creation is exactly the call that happens
        // before any organization is selected (onboarding).
        const organization = await xgBootstrap().createOrganization(input)
        await useAuthStore.getState().refreshMe()
        await get().setCurrentOrganization(organization.id)
        return organization
      },

      createWorkspace: async (input) => {
        const workspace = (await xg().workspaces.create(input)) as BrandedWorkspace
        set((state) => ({
          workspaces: [workspace, ...state.workspaces],
          currentWorkspaceId: workspace.id,
          // Onboarding creates the first workspace before any list has landed,
          // and the row in hand IS the organization's workspaces. Without this
          // the guards would still read "not loaded" and re-fetch to learn what
          // they already know.
          workspacesLoadedFor: state.currentOrganizationId,
        }))
        return workspace
      },

      updateWorkspace: async (id, input) => {
        const workspace = (await xg().workspaces.update(id, input)) as BrandedWorkspace
        set((state) => ({
          workspaces: state.workspaces.map((w) =>
            w.id === workspace.id ? workspace : w
          ),
        }))
        return workspace
      },

      applyWorkspace: (workspace) => {
        set((state) => ({
          workspaces: state.workspaces.map((w) =>
            w.id === workspace.id ? workspace : w
          ),
        }))
      },

      deleteWorkspace: async (id) => {
        const orgId = get().currentOrganizationId
        await xg().workspaces.delete(id)
        // Its fleet and every per-device key hang off this prefix; a refetch
        // would only 404 now.
        if (orgId) queryClient.removeQueries({ queryKey: qk.ws(orgId, id) })
        set((state) => {
          const workspaces = state.workspaces.filter((w) => w.id !== id)
          // If the active workspace was deleted, fall back to the first
          // remaining one so the rest of the app never points at a stale id.
          const currentWorkspaceId =
            state.currentWorkspaceId === id
              ? workspaces[0]?.id ?? null
              : state.currentWorkspaceId
          return { workspaces, currentWorkspaceId }
        })
      },

      deleteOrganization: async (id) => {
        await xg().organizations.delete(id)
        queryClient.removeQueries({ queryKey: qk.org(id) })
        await useAuthStore.getState().refreshMe()
      },

      reset: () => {
        flight = null
        set({
          currentOrganizationId: null,
          currentWorkspaceId: null,
          workspaces: [],
          workspacesLoadedFor: null,
          isLoadingWorkspaces: false,
        })
      },
    }),
    {
      name: "xorgate.workspace",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        currentOrganizationId: state.currentOrganizationId,
        currentWorkspaceId: state.currentWorkspaceId,
      }),
    }
  )
)

registerOrgIdGetter(() => useWorkspaceStore.getState().currentOrganizationId)
registerWorkspaceIdGetter(() => useWorkspaceStore.getState().currentWorkspaceId)

/** The organizations a user belongs to, as one comparable value. */
function orgKey(orgs: Array<{ id: string }>): string {
  return orgs.map((o) => o.id).join(",")
}

useAuthStore.subscribe((state, prevState) => {
  if (prevState.isAuthenticated && !state.isAuthenticated) {
    useWorkspaceStore.getState().reset()
    return
  }
  // Which organizations exist, not which object holds them. Editing an
  // organization (a renamed org, a new logo) replaces the array without
  // changing the membership set, and re-initializing on that would drop the
  // loaded workspaces and flash a skeleton in the switcher for no reason.
  if (
    state.isAuthenticated &&
    orgKey(state.organizations) !== orgKey(prevState.organizations)
  ) {
    void useWorkspaceStore.getState().initialize()
  }
})
