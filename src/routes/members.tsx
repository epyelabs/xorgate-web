import { createFileRoute, redirect } from "@tanstack/react-router"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { DataTable, type DataTableColumn } from "@/components/data-table"
import { Badge } from "@/components/ui/badge"
import { StickyHeader } from "@/components/sticky-header"
import { useAuthStore } from "@/store/auth"

export const Route = createFileRoute("/members")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: MembersPage,
})

// Placeholder member roster shown until member management is wired up.
const PLACEHOLDER_MEMBERS = [
  { name: "You", email: "", role: "Owner" },
  { name: "Teammate", email: "teammate@example.com", role: "Admin" },
]

function MembersPage() {
  const authUser = useAuthStore((s) => s.user)
  const ownerEmail = authUser?.email ?? ""

  const memberColumns: DataTableColumn<(typeof PLACEHOLDER_MEMBERS)[number]>[] = [
    {
      id: "name",
      header: "Name",
      cellClassName: "font-medium",
      cell: (member) => member.name,
    },
    {
      id: "email",
      header: "Email",
      cellClassName: "text-muted-foreground",
      cell: (member) => member.email || ownerEmail || "—",
    },
    {
      id: "role",
      header: "Role",
      cell: (member) => <Badge variant="secondary">{member.role}</Badge>,
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <StickyHeader className="border-b border-border pb-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
          <p className="text-sm text-muted-foreground">
            People with access to this organization.
          </p>
        </header>
      </StickyHeader>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            People with access to this organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            card={false}
            columns={memberColumns}
            rows={PLACEHOLDER_MEMBERS}
            getRowKey={(member, index) => member.email || `member-${index}`}
          />
        </CardContent>
      </Card>
    </div>
  )
}
