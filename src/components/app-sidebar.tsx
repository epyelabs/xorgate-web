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
  SidebarRail,
} from "@/components/ui/sidebar"
import { CpuIcon } from "lucide-react"
import { useAuthStore } from "@/store/auth"

const navMain = [
  { title: "Devices", url: "/devices", icon: <CpuIcon /> },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const authUser = useAuthStore((s) => s.user)

  const user = {
    name: authUser?.name ?? authUser?.email ?? "Guest",
    email: authUser?.email ?? "",
    avatar: "",
  }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
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
