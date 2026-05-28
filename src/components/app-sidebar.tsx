import * as React from "react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { OrganizationSwitcher } from "@/components/organization-switcher"
import { ProjectSwitcher } from "@/components/project-switcher"
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
import { CpuIcon } from "lucide-react"
import { XorgateLogo } from "@/components/xorgate-logo"
import { useAuthStore } from "@/store/auth"

const navMain = [{ title: "Devices", url: "/devices", icon: <CpuIcon /> }]

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
        <ProjectSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
