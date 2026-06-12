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

function resolveCrumbs(pathname: string, deviceName: string | null): Crumb[] {
  if (pathname === "/dashboard") return [{ label: "Dashboard" }]
  if (pathname === "/devices") return [{ label: "Devices" }]
  if (pathname.startsWith("/devices/")) {
    const deviceCrumb: Crumb = { label: deviceName ?? "Device" }
    const crumbs: Crumb[] = [{ label: "Devices", href: "/devices" }, deviceCrumb]
    if (pathname.endsWith("/live")) {
      deviceCrumb.href = pathname.slice(0, -"/live".length)
      crumbs.push({ label: "Live Telemetry" })
    } else if (pathname.endsWith("/history")) {
      deviceCrumb.href = pathname.slice(0, -"/history".length)
      crumbs.push({ label: "Historical Telemetry" })
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

  const crumbs = resolveCrumbs(location.pathname, deviceName)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
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
