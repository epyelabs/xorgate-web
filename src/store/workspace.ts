import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import {
  createOrganization as apiCreateOrganization,
  createWorkspace as apiCreateWorkspace,
  deleteWorkspace as apiDeleteWorkspace,
  listWorkspaces as apiListWorkspaces,
  updateWorkspace as apiUpdateWorkspace,
  registerOrgIdGetter,
  registerWorkspaceIdGetter,
  type Organization,
  type Workspace,
} from "@/lib/api"
import { useAuthStore } from "@/store/auth"

interface WorkspaceState {
  currentOrganizationId: string | null
  currentWorkspaceId: string | null
  workspaces: Workspace[]
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
  }) => Promise<Workspace>
  updateWorkspace: (
    id: string,
    input: { name?: string; slug?: string; description?: string | null }
  ) => Promise<Workspace>
  deleteWorkspace: (id: string) => Promise<void>
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
          const { workspaces } = await apiListWorkspaces()
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
        const { organization } = await apiCreateOrganization(input)
        await useAuthStore.getState().refreshMe()
        await get().setCurrentOrganization(organization.id)
        return organization
      },

      createWorkspace: async (input) => {
        const { workspace } = await apiCreateWorkspace(input)
        set((state) => ({
          workspaces: [workspace, ...state.workspaces],
          currentWorkspaceId: workspace.id,
        }))
        return workspace
      },

      updateWorkspace: async (id, input) => {
        const { workspace } = await apiUpdateWorkspace(id, input)
        set((state) => ({
          workspaces: state.workspaces.map((w) =>
            w.id === workspace.id ? workspace : w
          ),
        }))
        return workspace
      },

      deleteWorkspace: async (id) => {
        await apiDeleteWorkspace(id)
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

useAuthStore.subscribe((state, prevState) => {
  if (prevState.isAuthenticated && !state.isAuthenticated) {
    useWorkspaceStore.getState().reset()
    return
  }
  if (state.isAuthenticated && state.organizations !== prevState.organizations) {
    void useWorkspaceStore.getState().initialize()
  }
})
