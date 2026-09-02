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

  initialize: () => Promise<void>
  setCurrentOrganization: (orgId: string) => Promise<void>
  setCurrentWorkspace: (workspaceId: string) => void
  loadWorkspaces: () => Promise<void>
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

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      currentOrganizationId: null,
      currentWorkspaceId: null,
      workspaces: [],
      isLoadingWorkspaces: false,

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
        })
        await get().loadWorkspaces()
      },

      setCurrentWorkspace: (workspaceId) => {
        set({ currentWorkspaceId: workspaceId })
      },

      loadWorkspaces: async () => {
        if (!get().currentOrganizationId) {
          set({ workspaces: [], isLoadingWorkspaces: false })
          return
        }
        set({ isLoadingWorkspaces: true })
        try {
          // The SDK unwraps this envelope verbatim, so `logoUrl` really is on
          // the rows even though its published `Workspace` type predates it.
          const workspaces = (await xg().workspaces.list()) as BrandedWorkspace[]
          const persistedWorkspaceId = get().currentWorkspaceId
          const stillValid =
            persistedWorkspaceId && workspaces.some((p) => p.id === persistedWorkspaceId)
          const nextWorkspaceId = stillValid
            ? persistedWorkspaceId
            : workspaces[0]?.id ?? null
          set({
            workspaces,
            currentWorkspaceId: nextWorkspaceId,
            isLoadingWorkspaces: false,
          })
        } catch {
          set({ workspaces: [], isLoadingWorkspaces: false })
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
        set({
          currentOrganizationId: null,
          currentWorkspaceId: null,
          workspaces: [],
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
