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
  ChevronDownIcon,
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

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={!currentOrganizationId}>
              <SidebarMenuButton
                className="border border-sidebar-border bg-background hover:bg-background data-[state=open]:bg-background data-[state=open]:text-sidebar-accent-foreground"
              >
                <FolderIcon className="text-muted-foreground" />
                <div className="flex flex-1 text-left text-sm leading-tight">
                  {isLoading ? (
                    <Skeleton className="h-4 w-28" />
                  ) : (
                    <span className="truncate font-normal">{triggerLabel}</span>
                  )}
                </div>
                <ChevronDownIcon className="ml-auto text-muted-foreground" />
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
