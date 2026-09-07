import { useEffect } from "react"
import { useLocation, useNavigate } from "@tanstack/react-router"
import { NO_WORKSPACE_ROUTE } from "@/lib/auth-guard"
import { isWorkspaceScoped } from "@/lib/context-scope"
import { useAuthStore } from "@/store/auth"
import { useWorkspaceStore } from "@/store/workspace"

/**
 * Keeps a signed-in user off the workspace-scoped pages once the workspace
 * under them is gone.
 *
 * requireWorkspace already refuses to *navigate* there, but the same condition
 * can arrive with no navigation at all: switching to an organization that has
 * no workspace, or deleting the last one from Settings, both leave an open
 * /devices sitting on a context it can no longer query. beforeLoad does not
 * re-run for a store change, so the shell watches for it here instead.
 *
 * The check is deliberately `workspacesLoadedFor === currentOrganizationId`
 * rather than a bare `workspaces.length === 0`: on a cold boot, and for the
 * whole span of an organization switch, the list is empty simply because it has
 * not arrived, and redirecting on that would bounce users out of a workspace
 * they do have.
 */
export function useWorkspaceRouteGuard(): void {
  const navigate = useNavigate()
  const pathname = useLocation({ select: (l) => l.pathname })
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const currentOrganizationId = useWorkspaceStore(
    (s) => s.currentOrganizationId
  )
  const workspacesLoadedFor = useWorkspaceStore((s) => s.workspacesLoadedFor)
  const hasWorkspace = useWorkspaceStore((s) => s.workspaces.length > 0)

  const isStranded =
    isAuthenticated &&
    currentOrganizationId !== null &&
    workspacesLoadedFor === currentOrganizationId &&
    !hasWorkspace &&
    isWorkspaceScoped(pathname)

  useEffect(() => {
    if (isStranded) {
      void navigate({ to: NO_WORKSPACE_ROUTE, replace: true })
    }
  }, [isStranded, navigate])
}
