import { createFileRoute, redirect } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { StickyHeader } from "@/components/sticky-header"
import { useAuthStore } from "@/store/auth"
import { useWorkspaceStore } from "@/store/workspace"

export const Route = createFileRoute("/settings/")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: OrganizationSettingsPage,
})

// Placeholder member roster shown until member management is wired up.
const PLACEHOLDER_MEMBERS = [
  { name: "You", email: "", role: "Owner" },
  { name: "Teammate", email: "teammate@example.com", role: "Admin" },
]

function OrganizationSettingsPage() {
  const authUser = useAuthStore((s) => s.user)
  const organizations = useAuthStore((s) => s.organizations)
  const currentOrganizationId = useWorkspaceStore(
    (s) => s.currentOrganizationId
  )

  const activeOrg =
    organizations.find((o) => o.id === currentOrganizationId) ?? null
  const orgName = activeOrg?.name ?? ""
  const tier = authUser?.tier ?? "free"
  const ownerEmail = authUser?.email ?? ""

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

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
            <CardDescription>
              Your organization's name and identity.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-2 sm:max-w-sm">
              <Label htmlFor="org-name">Organization name</Label>
              <Input
                id="org-name"
                defaultValue={orgName}
                placeholder="Acme Inc."
              />
            </div>
            <div>
              <Button disabled>Save changes</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              People with access to this organization.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PLACEHOLDER_MEMBERS.map((member, index) => (
                  <TableRow key={member.email || `member-${index}`}>
                    <TableCell className="font-medium">{member.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.email || ownerEmail || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{member.role}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Billing</CardTitle>
            <CardDescription>
              Your current plan and usage tier.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium capitalize">{tier} plan</span>
              <span className="text-xs text-muted-foreground">
                Billed monthly.
              </span>
            </div>
            <Button variant="outline" disabled>
              Manage billing
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
