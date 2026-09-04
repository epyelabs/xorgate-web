import * as React from "react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { OrganizationSwitcher } from "@/components/organization-switcher"
import { WorkspaceSwitcher } from "@/components/workspace-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  Box,
  KeyRound,
  LayoutDashboard,
  Settings,
  Users,
  Waypoints,
} from "lucide-react"
import { Link } from "@tanstack/react-router"
import { XorgateAppIcon, XorgateLogo } from "@/components/xorgate-logo"
import { useAuthStore } from "@/store/auth"

const workspaceNav = [
  { title: "Devices", url: "/devices", icon: <Box /> },
  {
    title: "Workflow Instances",
    url: "/workflow-instances",
    icon: <Waypoints />,
  },
]

const organizationNav = [
  {
    title: "Workflow Templates",
    url: "/workflow-templates",
    icon: <LayoutDashboard />,
  },
  { title: "API Keys", url: "/api-keys", icon: <KeyRound /> },
  { title: "Members", url: "/members", icon: <Users /> },
  // Billing is hidden until the feature is ready; the /billing route still
  // exists, it just is not linked from the sidebar.
  // { title: "Billing", url: "/billing", icon: <CreditCard /> },
  { title: "Settings", url: "/settings", icon: <Settings /> },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const authUser = useAuthStore((s) => s.user)

  const user = {
    name: authUser?.name ?? authUser?.email ?? "Guest",
    email: authUser?.email ?? "",
    // Presigned and re-minted by every /me response; null until one lands, and
    // for anyone who has not set a picture (NavUser draws initials instead).
    avatar: authUser?.avatarUrl ?? null,
  }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* Expanded: the brand wordmark, as on the landing navbar.
                Collapsed to the icon rail: the square app icon (favicon),
                since the wordmark is 2.75:1 and would letterbox. */}
            <SidebarMenuButton size="lg" asChild>
              <Link
                to="/devices"
                aria-label="xorgate home"
                className="group-data-[collapsible=icon]:justify-center"
              >
                <XorgateAppIcon className="hidden size-6 group-data-[collapsible=icon]:block" />
                <XorgateLogo className="h-4! w-auto! text-brand group-data-[collapsible=icon]:hidden" />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <OrganizationSwitcher />
        <WorkspaceSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain label="Workspace" items={workspaceNav} />
        <NavMain label="Organization" items={organizationNav} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
