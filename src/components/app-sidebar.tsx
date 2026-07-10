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
  CreditCard,
  KeyRound,
  LayoutDashboard,
  Settings,
  Users,
  Waypoints,
} from "lucide-react"
import { XorgateLogo } from "@/components/xorgate-logo"
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
  { title: "Billing", url: "/billing", icon: <CreditCard /> },
  { title: "Settings", url: "/settings", icon: <Settings /> },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const authUser = useAuthStore((s) => s.user)

  const user = {
    name: authUser?.name ?? authUser?.email ?? "Guest",
    email: authUser?.email ?? "",
    avatar: "",
    tier: authUser?.tier ?? "free",
  }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="gap-1">
              <a href="/devices">
                <div className="flex aspect-square size-9 items-center justify-center rounded-md text-sidebar-primary">
                  <XorgateLogo className="size-6!" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">xorgate</span>
                  <span className="truncate text-xs text-muted-foreground">
                    AI-Native IoT Infrastructure
                  </span>
                </div>
              </a>
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
