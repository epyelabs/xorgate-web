import { Fragment, useEffect } from "react"
import { createRootRoute, Outlet, useLocation } from "@tanstack/react-router"
import { useAuthStore } from "@/store/auth"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import { AppSidebar } from "@/components/app-sidebar"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

interface Crumb {
  label: string
  href?: string
}

// Maps a device detail tab's path segment to its breadcrumb label. The leaf
// crumb is derived from the URL segment, so adding a tab route means adding it
// here too.
const DEVICE_TAB_LABELS: Record<string, string> = {
  streams: "Streams",
  telemetry: "Telemetry",
  media: "Media",
  workflows: "Workflows",
  settings: "Settings",
}

function resolveCrumbs(
  pathname: string,
  deviceName: string | null,
  templateName: string | null,
  instanceName: string | null
): Crumb[] {
  if (pathname === "/workflow-templates")
    return [{ label: "Workflow Templates" }]
  if (pathname.startsWith("/workflow-templates/")) {
    return [
      { label: "Workflow Templates", href: "/workflow-templates" },
      { label: templateName ?? "Template" },
    ]
  }
  if (pathname === "/workflow-instances")
    return [{ label: "Workflow Instances" }]
  if (pathname.startsWith("/workflow-instances/")) {
    return [
      { label: "Workflow Instances", href: "/workflow-instances" },
      { label: instanceName ?? "Instance" },
    ]
  }
  if (pathname === "/settings") return [{ label: "Settings" }]
  if (pathname === "/devices") return [{ label: "Devices" }]
  if (pathname.startsWith("/devices/")) {
    const deviceCrumb: Crumb = { label: deviceName ?? "Device" }
    const crumbs: Crumb[] = [{ label: "Devices", href: "/devices" }, deviceCrumb]
    const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1)
    const tabLabel = DEVICE_TAB_LABELS[lastSegment]
    if (tabLabel) {
      deviceCrumb.href = pathname.slice(0, -(lastSegment.length + 1))
      crumbs.push({ label: tabLabel })
    }
    return crumbs
  }
  return [{ label: "xorgate" }]
}

function LoadingScreen() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <span className="animate-pulse font-mono text-xs text-muted-foreground">
        Loading...
      </span>
    </div>
  )
}

const AUTH_ROUTES = ["/login", "/signup"]

function RootLayout() {
  const isLoading = useAuthStore((s) => s.isLoading)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const initialize = useAuthStore((s) => s.initialize)
  const deviceName = useBreadcrumbStore((s) => s.deviceName)
  const templateName = useBreadcrumbStore((s) => s.templateName)
  const instanceName = useBreadcrumbStore((s) => s.instanceName)
  const location = useLocation()

  useEffect(() => {
    initialize()
  }, [initialize])

  const isOnAuthRoute = AUTH_ROUTES.includes(location.pathname)

  if (isLoading || (isAuthenticated && isOnAuthRoute)) {
    return <LoadingScreen />
  }

  if (!isAuthenticated) {
    return <Outlet />
  }

  const crumbs = resolveCrumbs(
    location.pathname,
    deviceName,
    templateName,
    instanceName
  )

  return (
    <SidebarProvider>
      <AppSidebar />
      {/* min-w-0 lets the content area shrink to the available track so wide
          children (e.g. telemetry tables) scroll internally instead of
          overflowing the page horizontally. */}
      <SidebarInset className="min-w-0">
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-vertical:h-4 data-vertical:self-center"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="/devices">Home</BreadcrumbLink>
                </BreadcrumbItem>
                {crumbs.map((crumb, index) => {
                  const isLast = index === crumbs.length - 1
                  return (
                    <Fragment key={`${crumb.label}-${index}`}>
                      <BreadcrumbSeparator className="hidden md:block" />
                      {isLast ? (
                        <BreadcrumbItem>
                          <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                        </BreadcrumbItem>
                      ) : (
                        <BreadcrumbItem className="hidden md:block">
                          <BreadcrumbLink href={crumb.href}>
                            {crumb.label}
                          </BreadcrumbLink>
                        </BreadcrumbItem>
                      )}
                    </Fragment>
                  )
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}

export const Route = createRootRoute({
  component: RootLayout,
})
