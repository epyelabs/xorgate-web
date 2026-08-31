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
  Building2Icon,
  CheckIcon,
  ChevronDownIcon,
  PlusIcon,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { EntityLogo } from "@/components/entity-logo"
import { useAuthStore } from "@/store/auth"
import { useWorkspaceStore } from "@/store/workspace"
import { DEFAULT_AUTHED_ROUTE } from "@/lib/auth-guard"
import { shouldLeaveOnContextSwitch } from "@/lib/context-scope"
import { CreateOrganizationDialog } from "@/components/create-organization-dialog"

export function OrganizationSwitcher() {
  const { isMobile } = useSidebar()
  const navigate = useNavigate()
  const pathname = useLocation({ select: (l) => l.pathname })
  const organizations = useAuthStore((s) => s.organizations)
  const isAuthLoading = useAuthStore((s) => s.isLoading)
  const currentOrganizationId = useWorkspaceStore(
    (s) => s.currentOrganizationId
  )
  const setCurrentOrganization = useWorkspaceStore(
    (s) => s.setCurrentOrganization
  )
  const [dialogOpen, setDialogOpen] = useState(false)

  const activeOrg =
    organizations.find((o) => o.id === currentOrganizationId) ?? null
  const isLoadingOrgs = isAuthLoading && organizations.length === 0

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                className="border border-sidebar-border bg-background hover:bg-background data-[state=open]:bg-background data-[state=open]:text-sidebar-accent-foreground"
              >
                {/* The logo when there is one, the generic mark otherwise —
                    an organization without a logo should not read as a blank
                    tile. Same rule in the dropdown rows below. */}
                {activeOrg?.logoUrl ? (
                  <EntityLogo
                    name={activeOrg.name}
                    src={activeOrg.logoUrl}
                    className="size-5 rounded-sm after:rounded-sm"
                  />
                ) : (
                  <Building2Icon className="text-muted-foreground" />
                )}
                <div className="flex flex-1 text-left text-sm leading-tight">
                  {isLoadingOrgs ? (
                    <Skeleton className="h-4 w-28" />
                  ) : (
                    <span className="truncate font-normal">
                      {activeOrg?.name ?? "No organization"}
                    </span>
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
                Organizations
              </DropdownMenuLabel>
              {isLoadingOrgs ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 p-2"
                  >
                    <Skeleton className="size-6 rounded-md" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                ))
              ) : organizations.length === 0 ? (
                <DropdownMenuItem
                  disabled
                  className="text-muted-foreground italic"
                >
                  No organizations yet
                </DropdownMenuItem>
              ) : null}
              {organizations.map((org) => {
                const isActive = org.id === currentOrganizationId
                return (
                  <DropdownMenuItem
                    key={org.id}
                    onClick={() => {
                      if (isActive) return
                      // Leave a stranded detail page before the switch lands,
                      // so it never renders against the organization it no
                      // longer belongs to. List pages just refetch — those stay.
                      if (shouldLeaveOnContextSwitch(pathname, "organization")) {
                        void navigate({ to: DEFAULT_AUTHED_ROUTE })
                      }
                      void setCurrentOrganization(org.id)
                    }}
                    className="gap-2 p-2"
                  >
                    {org.logoUrl ? (
                      <EntityLogo
                        name={org.name}
                        src={org.logoUrl}
                        className="size-6 rounded-md after:rounded-md"
                      />
                    ) : (
                      <div className="flex size-6 items-center justify-center rounded-md border">
                        <Building2Icon className="size-3.5" />
                      </div>
                    )}
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
