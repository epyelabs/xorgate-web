import { Fragment, useEffect, useRef } from "react"
import {
  createRootRoute,
  Link,
  Outlet,
  useLocation,
  useRouterState,
} from "@tanstack/react-router"
import { useAuthStore } from "@/store/auth"
import { useWorkspaceStore } from "@/store/workspace"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import { ensureAuthInitialized } from "@/lib/auth-guard"
import { useWorkspaceRouteGuard } from "@/lib/use-workspace-route-guard"
import { markAppShellMounted } from "@/lib/app-shell"
import { AppErrorScreen, NotFoundScreen } from "@/components/error-screens"
import { AppLoadingScreen } from "@/components/app-loading-screen"
import { AppSidebar } from "@/components/app-sidebar"
import { GlobalSearch } from "@/components/global-search"
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
  if (pathname === "/onboarding") return [{ label: "Get started" }]
  if (pathname === "/no-workspace") return [{ label: "No workspace" }]
  if (pathname === "/forbidden") return [{ label: "Access denied" }]
  if (pathname === "/settings") return [{ label: "Settings" }]
  if (pathname === "/members") return [{ label: "Members" }]
  if (pathname === "/api-keys") return [{ label: "API Keys" }]
  if (pathname === "/billing") return [{ label: "Billing" }]
  if (pathname === "/devices") return [{ label: "Devices" }]
  if (pathname.startsWith("/devices/")) {
    const deviceCrumb: Crumb = { label: deviceName ?? "Device" }
    const crumbs: Crumb[] = [
      { label: "Devices", href: "/devices" },
      deviceCrumb,
    ]
    const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1)
    const tabLabel = DEVICE_TAB_LABELS[lastSegment]
    if (tabLabel) {
      deviceCrumb.href = pathname.slice(0, -(lastSegment.length + 1))
      crumbs.push({ label: tabLabel })
    }
    return crumbs
  }
  // Every real route is listed above, so anything reaching here is a path with
  // no match — the same case the 404 screen below is rendering for.
  return [{ label: "Not found" }]
}

// A breadcrumb ancestor is never the page you are on — the leaf renders as
// BreadcrumbPage instead. Link's default active matching is a fuzzy prefix, so
// without this every ancestor crumb lit up as "active" (and carried the `active`
// class) the moment you were anywhere beneath it: /devices/<id> made the
// "Devices" crumb claim to be the current page.
const CRUMB_LINK_PROPS = {
  activeOptions: { exact: true },
  activeProps: {},
} as const

// /auth/callback belongs here too: once the Google round trip has produced a
// session it holds the loading screen until the callback navigates onward.
const AUTH_ROUTES = ["/login", "/signup", "/auth/callback"]

// Routes a SIGNED-IN user sees without the app chrome. /onboarding is the only
// one: the sidebar is built out of the organization switcher and org-scoped nav
// targets, which is exactly what a user who has landed there does not have yet.
// It deliberately does NOT go in AUTH_ROUTES, because that list means "bounce a
// signed-in user away from here", and onboarding is only ever for signed-in
// users.
const CHROMELESS_AUTHED_ROUTES = ["/onboarding"]

function RootLayout() {
  const isLoading = useAuthStore((s) => s.isLoading)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const deviceName = useBreadcrumbStore((s) => s.deviceName)
  const templateName = useBreadcrumbStore((s) => s.templateName)
  const instanceName = useBreadcrumbStore((s) => s.instanceName)
  const location = useLocation()

  // The initial route load blocks in beforeLoad on /me, and /me's arrival
  // kicks off the first /workspaces fetch. Rendering the chrome before both
  // settle shows the sidebar with "No organization" placeholders, so the whole
  // shell holds behind the loading screen until the boot has settled once.
  //
  // "Settled" is the router going idle with no workspace fetch in flight — NOT
  // "profile loaded": a failed /me also sends the router idle (the guard's
  // error renders in the outlet), and gating on success would hide that error
  // screen behind an infinite loading hold. The latch is one-way so later
  // navigations and org switches (which re-run the workspace fetch) never
  // blank the whole app again.
  const routerStatus = useRouterState({ select: (s) => s.status })
  const isLoadingWorkspaces = useWorkspaceStore((s) => s.isLoadingWorkspaces)
  const bootSettledRef = useRef(false)
  if (routerStatus === "idle" && !isLoadingWorkspaces) {
    bootSettledRef.current = true
  }

  useEffect(() => {
    void ensureAuthInitialized()
  }, [])

  // requireWorkspace covers arriving at a workspace-scoped page. This covers
  // the other direction: the workspace going away under a page already open,
  // which is a store change rather than a navigation, so no guard re-runs.
  useWorkspaceRouteGuard()

  const isOnAuthRoute = AUTH_ROUTES.includes(location.pathname)

  if (isLoading || (isAuthenticated && isOnAuthRoute)) {
    return <AppLoadingScreen label="Restoring your session" />
  }

  if (!isAuthenticated) {
    return <Outlet />
  }

  if (CHROMELESS_AUTHED_ROUTES.includes(location.pathname)) {
    return <Outlet />
  }

  if (!bootSettledRef.current) {
    return <AppLoadingScreen />
  }

  // Past this point the shell renders, so the two holds above are the only
  // full-screen ones the app should ever show. Tells the router's pending
  // component to stop reaching for the brand screen on later navigations.
  markAppShellMounted()

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
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 bg-background transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-vertical:h-4 data-vertical:self-center"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  {/* asChild + router Link, not a bare href: a plain anchor
                      navigates the document, which tears the SPA down and
                      re-boots it — sidebar, session revalidation, loading
                      screen and all — for what should be a client-side hop. */}
                  <BreadcrumbLink asChild>
                    <Link to="/devices" {...CRUMB_LINK_PROPS}>
                      Home
                    </Link>
                  </BreadcrumbLink>
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
                          <BreadcrumbLink asChild>
                            <Link to={crumb.href} {...CRUMB_LINK_PROPS}>
                              {crumb.label}
                            </Link>
                          </BreadcrumbLink>
                        </BreadcrumbItem>
                      )}
                    </Fragment>
                  )
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="ml-auto flex items-center gap-2 px-4">
            <GlobalSearch />
          </div>
        </header>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}

export const Route = createRootRoute({
  component: RootLayout,
  // Both render inside RootLayout's <Outlet />, so a signed-in user keeps the
  // sidebar and breadcrumb while a signed-out one gets the bare screen.
  notFoundComponent: NotFoundScreen,
  errorComponent: ({ error, reset }) => (
    <AppErrorScreen error={error} reset={reset} />
  ),
})
