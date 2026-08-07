import { useState } from "react"
import { useLocation, useNavigate } from "@tanstack/react-router"
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
import { DEFAULT_AUTHED_ROUTE } from "@/lib/auth-guard"
import { shouldLeaveOnContextSwitch } from "@/lib/context-scope"
import { CreateWorkspaceDialog } from "@/components/create-workspace-dialog"

export function WorkspaceSwitcher() {
  const { isMobile } = useSidebar()
  const navigate = useNavigate()
  const pathname = useLocation({ select: (l) => l.pathname })
  const currentOrganizationId = useWorkspaceStore(
    (s) => s.currentOrganizationId
  )
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const isLoading = useWorkspaceStore((s) => s.isLoadingWorkspaces)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace)
  const [dialogOpen, setDialogOpen] = useState(false)

  const activeWorkspace =
    workspaces.find((p) => p.id === currentWorkspaceId) ?? null

  const triggerLabel = (() => {
    if (!currentOrganizationId) return "Select an organization"
    if (activeWorkspace) return activeWorkspace.name
    if (workspaces.length === 0) return "No workspaces yet"
    return "Select a workspace"
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
                Workspaces
              </DropdownMenuLabel>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2 p-2">
                    <Skeleton className="size-6 rounded-md" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                ))
              ) : workspaces.length === 0 ? (
                <DropdownMenuItem
                  disabled
                  className="text-muted-foreground italic"
                >
                  No workspaces yet
                </DropdownMenuItem>
              ) : null}
              {workspaces.map((workspace) => {
                const isActive = workspace.id === currentWorkspaceId
                return (
                  <DropdownMenuItem
                    key={workspace.id}
                    onClick={() => {
                      if (isActive) return
                      // Same reasoning as the organization switcher, minus the
                      // organization-scoped pages — a workspace switch leaves
                      // those (workflow templates, members, billing) intact.
                      if (shouldLeaveOnContextSwitch(pathname, "workspace")) {
                        void navigate({ to: DEFAULT_AUTHED_ROUTE })
                      }
                      setCurrentWorkspace(workspace.id)
                    }}
                    className="gap-2 p-2"
                  >
                    <div className="flex size-6 items-center justify-center rounded-md border">
                      <FolderIcon className="size-3.5" />
                    </div>
                    <span className="truncate">{workspace.name}</span>
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
                  Create workspace
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <CreateWorkspaceDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}
