import { useEffect } from "react"
import { createRootRoute, Outlet, useLocation } from "@tanstack/react-router"
import { useAuthStore } from "@/store/auth"
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

function resolvePageTitle(pathname: string): string {
  if (pathname === "/dashboard") return "Dashboard"
  if (pathname === "/devices") return "Devices"
  if (pathname.startsWith("/devices/")) return "Device Detail"
  return "xorgate"
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

  const pageTitle = resolvePageTitle(location.pathname)

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
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
                </BreadcrumbItem>
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
