import * as React from "react"
import { useState } from "react"

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
  Boxes,
  KeyRound,
  LayoutDashboard,
  Settings,
  Users,
  Waypoints,
} from "lucide-react"
import { Link } from "@tanstack/react-router"
import { XorgateAppIcon, XorgateLogo } from "@/components/xorgate-logo"
import { useAuthStore } from "@/store/auth"
import { useWorkspaceStore } from "@/store/workspace"
import { CreateWorkspaceDialog } from "@/components/create-workspace-dialog"

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
  // Trained networks, not hardware SKUs: datasets to label, the jobs that
  // train on them, and the registry the template editor picks from.
  {
    title: "Models",
    url: "/datasets",
    icon: <Boxes />,
    items: [
      { title: "Datasets", url: "/datasets" },
      { title: "Training", url: "/training-jobs" },
      { title: "Registry", url: "/models" },
    ],
  },
  { title: "API Keys", url: "/api-keys", icon: <KeyRound /> },
  { title: "Members", url: "/members", icon: <Users /> },
  // Billing is hidden until the feature is ready; the /billing route still
  // exists, it just is not linked from the sidebar.
  // { title: "Billing", url: "/billing", icon: <CreditCard /> },
  { title: "Settings", url: "/settings", icon: <Settings /> },
]

// Shown in place of the workspace nav when the organization has no workspace,
// so the section reads as "nothing here yet" rather than offering two links
// that only bounce to /no-workspace. Hidden on the icon rail, where there is no
// room for prose — the group collapses to nothing there, which is the honest
// picture.
//
// "Create one" opens the same dialog as the switcher's Create workspace button:
// the sentence already tells you what to do, so it should be the thing that
// does it rather than a caption pointing at a control above it. Its own dialog
// instance rather than shared state — the dialog is self-contained and only one
// can be open at a time, which is how /settings mounts it too.
function NoWorkspaceNav() {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className="px-2 py-1 group-data-[collapsible=icon]:hidden">
      <p className="text-xs text-muted-foreground">
        No workspace yet.{" "}
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="underline underline-offset-2 transition-colors hover:text-foreground"
        >
          Create one
        </button>{" "}
        to add devices and workflow instances.
      </p>
      <CreateWorkspaceDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const authUser = useAuthStore((s) => s.user)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const isLoadingWorkspaces = useWorkspaceStore((s) => s.isLoadingWorkspaces)
  // Only once the list has actually landed: mid-fetch (a cold boot, an
  // organization switch) `workspaces` is empty for want of an answer, not for
  // want of a workspace, and swapping the nav out on that flashes the
  // placeholder at users who have one.
  const hasWorkspaceNav = isLoadingWorkspaces || workspaces.length > 0

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
        <NavMain
          label="Workspace"
          items={hasWorkspaceNav ? workspaceNav : []}
          empty={<NoWorkspaceNav />}
        />
        <NavMain label="Organization" items={organizationNav} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
