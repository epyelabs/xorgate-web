import { useEffect, useState } from "react"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { FolderIcon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusScreen } from "@/components/error-screens"
import { CreateWorkspaceDialog } from "@/components/create-workspace-dialog"
import { DEFAULT_AUTHED_ROUTE, requireAuth } from "@/lib/auth-guard"
import { roleHasPermission, ROLE_LABEL, rolesWithPermission, useCurrentRole } from "@/lib/permissions"
import { useWorkspaceStore } from "@/store/workspace"

// Where requireWorkspace sends a user whose organization has no workspace.
// Guarded by requireAuth rather than requireWorkspace: requireWorkspace
// redirects here, so guarding this route with it would loop — the same shape as
// /onboarding's relationship with requireAuth.
export const Route = createFileRoute("/no-workspace")({
  beforeLoad: async (opts) => {
    await requireAuth(opts)
    // requireAuth stops at the organization check, so this route asks for the
    // workspace list itself. Without it the bounce below would read an
    // unloaded `workspaces: []` and strand a user who does have one.
    await useWorkspaceStore.getState().ensureWorkspaces()
    // Has a workspace, or arrived by typing the URL. Nothing to do here.
    if (useWorkspaceStore.getState().workspaces.length > 0) {
      throw redirect({ to: DEFAULT_AUTHED_ROUTE, replace: true })
    }
  },
  component: NoWorkspacePage,
})

function NoWorkspacePage() {
  const navigate = useNavigate()
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const role = useCurrentRole()
  const canCreate = role ? roleHasPermission(role, "workspace:manage") : false
  const [dialogOpen, setDialogOpen] = useState(false)

  // A workspace can appear without any navigation: the dialog below, the same
  // one in the sidebar switcher, or a switch to an organization that has one.
  // The dialog only sees itself off *detail* pages, and this is not one, so
  // this page has to leave under its own power once there is somewhere to go.
  const hasWorkspace = workspaces.length > 0
  useEffect(() => {
    if (hasWorkspace) {
      void navigate({ to: DEFAULT_AUTHED_ROUTE, replace: true })
    }
  }, [hasWorkspace, navigate])

  const managerRoles = rolesWithPermission("workspace:manage")

  return (
    <>
      <StatusScreen
        icon={<FolderIcon />}
        title="This organization has no workspace"
        description={
          canCreate
            ? "Devices and workflow instances live inside a workspace, so there is nowhere to put them yet. Create one and the rest of the app opens up."
            : `Devices and workflow instances live inside a workspace, and this organization has none yet. Ask ${managerRoles
                .map((r) => ROLE_LABEL[r].toLowerCase() + "s")
                .join(" or ")} of this organization to create one.`
        }
        actions={
          canCreate ? (
            <Button onClick={() => setDialogOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              Create workspace
            </Button>
          ) : null
        }
      />
      <CreateWorkspaceDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}
