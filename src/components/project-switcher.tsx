import { useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  CheckIcon,
  ChevronsUpDownIcon,
  FolderIcon,
  PlusIcon,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspaceStore } from "@/store/workspace"
import { CreateProjectDialog } from "@/components/create-project-dialog"

export function ProjectSwitcher() {
  const { isMobile } = useSidebar()
  const currentOrganizationId = useWorkspaceStore(
    (s) => s.currentOrganizationId
  )
  const projects = useWorkspaceStore((s) => s.projects)
  const isLoading = useWorkspaceStore((s) => s.isLoadingProjects)
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId)
  const setCurrentProject = useWorkspaceStore((s) => s.setCurrentProject)
  const [dialogOpen, setDialogOpen] = useState(false)

  const activeProject =
    projects.find((p) => p.id === currentProjectId) ?? null

  const triggerLabel = (() => {
    if (!currentOrganizationId) return "Select an organization"
    if (activeProject) return activeProject.name
    if (projects.length === 0) return "No projects yet"
    return "Select a project"
  })()

  const triggerSubLabel = activeProject?.slug ?? "Project"

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={!currentOrganizationId}>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-md border">
                  <FolderIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  {isLoading ? (
                    <>
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="mt-1 h-3 w-16" />
                    </>
                  ) : (
                    <>
                      <span className="truncate font-medium">{triggerLabel}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {triggerSubLabel}
                      </span>
                    </>
                  )}
                </div>
                <ChevronsUpDownIcon className="ml-auto" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-56"
              align="start"
              side={isMobile ? "bottom" : "right"}
              sideOffset={4}
            >
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Projects
              </DropdownMenuLabel>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2 p-2">
                    <Skeleton className="size-6 rounded-md" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                ))
              ) : projects.length === 0 ? (
                <DropdownMenuItem
                  disabled
                  className="text-muted-foreground italic"
                >
                  No projects yet
                </DropdownMenuItem>
              ) : null}
              {projects.map((project) => {
                const isActive = project.id === currentProjectId
                return (
                  <DropdownMenuItem
                    key={project.id}
                    onClick={() => setCurrentProject(project.id)}
                    className="gap-2 p-2"
                  >
                    <div className="flex size-6 items-center justify-center rounded-md border">
                      <FolderIcon className="size-3.5" />
                    </div>
                    <span className="truncate">{project.name}</span>
                    {isActive && <CheckIcon className="ml-auto size-3.5" />}
                  </DropdownMenuItem>
                )
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setDialogOpen(true)}
                disabled={!currentOrganizationId}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                  <PlusIcon className="size-4" />
                </div>
                <div className="font-medium text-muted-foreground">
                  Create project
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <CreateProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}
