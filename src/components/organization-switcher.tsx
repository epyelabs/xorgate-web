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
  Building2Icon,
  CheckIcon,
  ChevronsUpDownIcon,
  PlusIcon,
} from "lucide-react"
import { useAuthStore } from "@/store/auth"
import { useWorkspaceStore } from "@/store/workspace"
import { CreateOrganizationDialog } from "@/components/create-organization-dialog"

export function OrganizationSwitcher() {
  const { isMobile } = useSidebar()
  const organizations = useAuthStore((s) => s.organizations)
  const currentOrganizationId = useWorkspaceStore(
    (s) => s.currentOrganizationId
  )
  const setCurrentOrganization = useWorkspaceStore(
    (s) => s.setCurrentOrganization
  )
  const [dialogOpen, setDialogOpen] = useState(false)

  const activeOrg =
    organizations.find((o) => o.id === currentOrganizationId) ?? null

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Building2Icon />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {activeOrg?.name ?? "No organization"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {activeOrg?.slug ?? "Create one to get started"}
                  </span>
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
                Organizations
              </DropdownMenuLabel>
              {organizations.length === 0 && (
                <DropdownMenuItem
                  disabled
                  className="text-muted-foreground italic"
                >
                  No organizations yet
                </DropdownMenuItem>
              )}
              {organizations.map((org) => {
                const isActive = org.id === currentOrganizationId
                return (
                  <DropdownMenuItem
                    key={org.id}
                    onClick={() => {
                      void setCurrentOrganization(org.id)
                    }}
                    className="gap-2 p-2"
                  >
                    <div className="flex size-6 items-center justify-center rounded-md border">
                      <Building2Icon className="size-3.5" />
                    </div>
                    <span className="truncate">{org.name}</span>
                    {isActive && <CheckIcon className="ml-auto size-3.5" />}
                  </DropdownMenuItem>
                )
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setDialogOpen(true)}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                  <PlusIcon className="size-4" />
                </div>
                <div className="font-medium text-muted-foreground">
                  Create organization
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <CreateOrganizationDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}
