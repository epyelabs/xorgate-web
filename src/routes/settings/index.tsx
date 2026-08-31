import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { RequirePermission } from "@/components/require-permission"
import { MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable, type DataTableColumn } from "@/components/data-table"
import { StickyHeader } from "@/components/sticky-header"
import { CreateWorkspaceDialog } from "@/components/create-workspace-dialog"
import { EntityLogo } from "@/components/entity-logo"
import { LogoField } from "@/components/logo-field"
import {
  removeOrganizationLogo,
  uploadOrganizationLogo,
  type BrandedWorkspace,
} from "@/lib/branding-api"
import { useAuthStore } from "@/store/auth"
import { useWorkspaceStore } from "@/store/workspace"
import { EditWorkspaceDialog } from "./-components/edit-workspace-dialog"
import { DeleteWorkspaceDialog } from "./-components/delete-workspace-dialog"
import { CredentialsCard } from "./-components/credentials-card"

export const Route = createFileRoute("/settings/")({
  beforeLoad: requireAuth,
  component: () => (
    <RequirePermission permission="workspace:manage">
      <OrganizationSettingsPage />
    </RequirePermission>
  ),
})

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })

function formatDate(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return dateFormat.format(parsed)
}

function OrganizationSettingsPage() {
  const organizations = useAuthStore((s) => s.organizations)
  const applyOrganization = useAuthStore((s) => s.applyOrganization)
  const currentOrganizationId = useWorkspaceStore(
    (s) => s.currentOrganizationId
  )
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const isLoadingWorkspaces = useWorkspaceStore((s) => s.isLoadingWorkspaces)

  const activeOrg =
    organizations.find((o) => o.id === currentOrganizationId) ?? null
  const orgName = activeOrg?.name ?? ""

  // The field has to be controlled: `defaultValue` is read once at mount, so
  // switching organizations (or the /me response landing a beat after the first
  // render) would leave the previous name sitting in the box. Re-seeding keys
  // off the name rather than the org id so both cases are covered, and only
  // when the upstream value actually changes — typing is never clobbered.
  // Adjust-state-during-render, as in the workflow-instances list.
  const [nameDraft, setNameDraft] = useState(orgName)
  const [seenOrgName, setSeenOrgName] = useState(orgName)
  if (seenOrgName !== orgName) {
    setSeenOrgName(orgName)
    setNameDraft(orgName)
  }

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<BrandedWorkspace | null>(null)
  const [deleting, setDeleting] = useState<BrandedWorkspace | null>(null)

  const workspaceColumns: DataTableColumn<BrandedWorkspace>[] = [
    {
      id: "name",
      header: "Name",
      cellClassName: "font-medium",
      cell: (workspace) => (
        <div className="flex items-center gap-2">
          <EntityLogo
            name={workspace.name}
            src={workspace.logoUrl}
            className="size-6"
          />
          {workspace.name}
        </div>
      ),
    },
    {
      id: "slug",
      header: "Slug",
      cellClassName: "font-mono text-muted-foreground",
      cell: (workspace) => workspace.slug,
    },
    {
      id: "description",
      header: "Description",
      cellClassName: "text-muted-foreground",
      cell: (workspace) => workspace.description || "—",
    },
    {
      id: "created",
      header: "Created",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (workspace) => formatDate(workspace.createdAt),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (workspace) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Actions for ${workspace.name}`}
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditing(workspace)}>
              <PencilIcon />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setDeleting(workspace)}
            >
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <StickyHeader className="border-b border-border pb-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage settings for your organization.
          </p>
        </header>
      </StickyHeader>

      <Tabs defaultValue="general" className="gap-6">
        <div className="border-b border-border">
          <TabsList variant="line">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="credentials">Credentials</TabsTrigger>
            <TabsTrigger value="workspaces">Workspaces</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
              <CardDescription>
                Your organization's name and identity.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {/* Not part of the form below: an upload lands on its own, so
                  there is no half-saved state where the logo changed and the
                  name did not. */}
              <div className="flex flex-col gap-2">
                <Label>Logo</Label>
                <LogoField
                  name={orgName}
                  logoUrl={activeOrg?.logoUrl ?? null}
                  disabled={!activeOrg}
                  inputTestId="organization-logo-input"
                  onUpload={async (input) => {
                    if (!activeOrg) return
                    const { organization } = await uploadOrganizationLogo(
                      activeOrg.id,
                      input
                    )
                    applyOrganization(organization)
                  }}
                  onRemove={async () => {
                    if (!activeOrg) return
                    const { organization } = await removeOrganizationLogo(
                      activeOrg.id
                    )
                    applyOrganization(organization)
                  }}
                />
              </div>
              <div className="grid gap-2 sm:max-w-sm">
                <Label htmlFor="org-name">Organization name</Label>
                <Input
                  id="org-name"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="Acme Inc."
                />
              </div>
              <div>
                <Button disabled>Save changes</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="credentials">
          <CredentialsCard />
        </TabsContent>

        <TabsContent value="workspaces">
          <Card>
            <CardHeader>
              <CardTitle>Workspaces</CardTitle>
              <CardDescription>
                Workspaces group related resources inside this organization.
              </CardDescription>
              <CardAction>
                <Button
                  size="sm"
                  onClick={() => setCreateOpen(true)}
                  disabled={!currentOrganizationId}
                >
                  <PlusIcon />
                  New workspace
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <DataTable
                card={false}
                columns={workspaceColumns}
                rows={workspaces}
                getRowKey={(workspace) => workspace.id}
                loading={isLoadingWorkspaces}
                skeletonRows={3}
                empty={
                  <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-medium">No workspaces yet</p>
                      <p className="text-xs text-muted-foreground">
                        Create a workspace to start grouping devices and
                        workflows.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setCreateOpen(true)}
                      disabled={!currentOrganizationId}
                    >
                      <PlusIcon />
                      New workspace
                    </Button>
                  </div>
                }
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
      <EditWorkspaceDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        workspace={editing}
      />
      <DeleteWorkspaceDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        workspace={deleting}
      />
    </div>
  )
}
