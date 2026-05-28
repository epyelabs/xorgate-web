import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import {
  createOrganization as apiCreateOrganization,
  createProject as apiCreateProject,
  listProjects as apiListProjects,
  registerOrgIdGetter,
  type Organization,
  type Project,
} from "@/lib/api"
import { useAuthStore } from "@/store/auth"

interface WorkspaceState {
  currentOrganizationId: string | null
  currentProjectId: string | null
  projects: Project[]
  isLoadingProjects: boolean

  initialize: () => Promise<void>
  setCurrentOrganization: (orgId: string) => Promise<void>
  setCurrentProject: (projectId: string) => void
  loadProjects: () => Promise<void>
  createOrganization: (input: { name: string; slug: string }) => Promise<Organization>
  createProject: (input: {
    name: string
    slug: string
    description?: string
  }) => Promise<Project>
  reset: () => void
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      currentOrganizationId: null,
      currentProjectId: null,
      projects: [],
      isLoadingProjects: false,

      initialize: async () => {
        const orgs = useAuthStore.getState().organizations
        const persisted = get().currentOrganizationId
        const validPersisted =
          persisted && orgs.some((o) => o.id === persisted) ? persisted : null
        const nextOrgId = validPersisted ?? orgs[0]?.id ?? null

        if (nextOrgId !== get().currentOrganizationId) {
          set({
            currentOrganizationId: nextOrgId,
            currentProjectId: null,
            projects: [],
          })
        }

        if (nextOrgId) {
          await get().loadProjects()
        }
      },

      setCurrentOrganization: async (orgId) => {
        if (orgId === get().currentOrganizationId) return
        set({
          currentOrganizationId: orgId,
          currentProjectId: null,
          projects: [],
        })
        await get().loadProjects()
      },

      setCurrentProject: (projectId) => {
        set({ currentProjectId: projectId })
      },

      loadProjects: async () => {
        if (!get().currentOrganizationId) {
          set({ projects: [], isLoadingProjects: false })
          return
        }
        set({ isLoadingProjects: true })
        try {
          const { projects } = await apiListProjects()
          const persistedProjectId = get().currentProjectId
          const stillValid =
            persistedProjectId && projects.some((p) => p.id === persistedProjectId)
          const nextProjectId = stillValid
            ? persistedProjectId
            : projects[0]?.id ?? null
          set({
            projects,
            currentProjectId: nextProjectId,
            isLoadingProjects: false,
          })
        } catch {
          set({ projects: [], isLoadingProjects: false })
        }
      },

      createOrganization: async (input) => {
        const { organization } = await apiCreateOrganization(input)
        await useAuthStore.getState().refreshMe()
        await get().setCurrentOrganization(organization.id)
        return organization
      },

      createProject: async (input) => {
        const { project } = await apiCreateProject(input)
        set((state) => ({
          projects: [project, ...state.projects],
          currentProjectId: project.id,
        }))
        return project
      },

      reset: () => {
        set({
          currentOrganizationId: null,
          currentProjectId: null,
          projects: [],
          isLoadingProjects: false,
        })
      },
    }),
    {
      name: "xorgate.workspace",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        currentOrganizationId: state.currentOrganizationId,
        currentProjectId: state.currentProjectId,
      }),
    }
  )
)

registerOrgIdGetter(() => useWorkspaceStore.getState().currentOrganizationId)

useAuthStore.subscribe((state, prevState) => {
  if (prevState.isAuthenticated && !state.isAuthenticated) {
    useWorkspaceStore.getState().reset()
    return
  }
  if (state.isAuthenticated && state.organizations !== prevState.organizations) {
    void useWorkspaceStore.getState().initialize()
  }
})
