import { useCallback, useEffect, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { RequirePermission } from "@/components/require-permission"
import { toast } from "sonner"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { DataTable, type DataTableColumn } from "@/components/data-table"
import { StickyHeader } from "@/components/sticky-header"
import type { MembershipRole, MembershipWithUser } from "@xorgate/sdk"
import { xg, xgMessage } from "@/lib/xorgate"
import { formatRelative } from "@/lib/relative-time"
import { useAuthStore } from "@/store/auth"
import { useWorkspaceStore } from "@/store/workspace"
import { AddMemberDialog } from "./-components/add-member-dialog"
import { RemoveMemberDialog } from "./-components/remove-member-dialog"

export const Route = createFileRoute("/members/")({
  beforeLoad: requireAuth,
  component: () => (
    <RequirePermission permission="members:read">
      <MembersPage />
    </RequirePermission>
  ),
})

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return dateTimeFormat.format(parsed)
}

const ROLE_LABEL: Record<MembershipRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
}

const ROLE_VARIANT: Record<MembershipRole, "default" | "secondary" | "outline"> = {
  owner: "default",
  admin: "secondary",
  member: "outline",
  viewer: "outline",
}

function displayName(member: MembershipWithUser): string {
  return member.user?.name?.trim() || member.user?.email || "Unknown user"
}

function initials(member: MembershipWithUser): string {
  const name = member.user?.name?.trim()
  if (name) {
    const parts = name.split(/\s+/)
    return (parts[0]![0]! + (parts[1]?.[0] ?? "")).toUpperCase()
  }
  return (member.user?.email?.[0] ?? "?").toUpperCase()
}

interface MembersData {
  organizationId: string | null
  members: MembershipWithUser[]
}

function MembersPage() {
  const [data, setData] = useState<MembersData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [removing, setRemoving] = useState<MembershipWithUser | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  const authUserId = useAuthStore((s) => s.user?.id ?? null)
  const authMemberships = useAuthStore((s) => s.memberships)
  const currentOrganizationId = useWorkspaceStore((s) => s.currentOrganizationId)

  // The caller's own role in the active org drives whether write actions show.
  const callerRole = useMemo<MembershipRole | null>(() => {
    const m = authMemberships.find(
      (m) => m.organizationId === currentOrganizationId
    )
    return m?.role ?? null
  }, [authMemberships, currentOrganizationId])
  const canManage = callerRole === "owner" || callerRole === "admin"

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const memberships = await xg().memberships.list()
        if (cancelled) return
        setError(null)
        setData({ organizationId: currentOrganizationId, members: memberships })
      } catch (err) {
        const message = xgMessage(err)
        if (cancelled) return
        setError(message)
        setData({ organizationId: currentOrganizationId, members: [] })
        toast.error(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [currentOrganizationId, reloadNonce])

  const isLoading = !data || data.organizationId !== currentOrganizationId
  const members = isLoading ? [] : data.members

  const reload = useCallback(() => setReloadNonce((n) => n + 1), [])

  const columns: DataTableColumn<MembershipWithUser>[] = [
    {
      id: "member",
      header: "Member",
      cell: (member) => {
        const isSelf = member.userId === authUserId
        return (
          <div className="flex items-center gap-3">
            <Avatar size="sm">
              <AvatarFallback>{initials(member)}</AvatarFallback>
            </Avatar>
            <span className="font-medium">{displayName(member)}</span>
            {isSelf ? (
              <Badge variant="outline" className="text-muted-foreground">
                You
              </Badge>
            ) : null}
          </div>
        )
      },
    },
    {
      id: "email",
      header: "Email",
      cellClassName: "text-muted-foreground",
      cell: (member) => member.user?.email ?? "—",
    },
    {
      id: "role",
      header: "Role",
      cell: (member) => (
        <Badge variant={ROLE_VARIANT[member.role]}>
          {ROLE_LABEL[member.role]}
        </Badge>
      ),
    },
    {
      id: "joined",
      header: "Joined",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (member) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default">
              {formatRelative(member.createdAt)}
            </span>
          </TooltipTrigger>
          <TooltipContent>{formatTimestamp(member.createdAt)}</TooltipContent>
        </Tooltip>
      ),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (member) => {
        // Owner/admin can remove others. Removing yourself (leaving the org) is a
        // separate flow, so the self row has no action.
        if (!canManage || member.userId === authUserId) return null
        return (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${displayName(member)}`}
            onClick={() => setRemoving(member)}
          >
            <Trash2Icon />
          </Button>
        )
      },
    },
  ]

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-0 min-w-0 flex-col gap-6 p-4 pt-0 group-has-data-[collapsible=icon]/sidebar-wrapper:h-[calc(100svh-3rem)]">
      <StickyHeader className="border-b border-border pb-4">
        <header className="flex flex-wrap items-start gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
            <p className="text-sm text-muted-foreground">
              People with access to this organization.
            </p>
          </div>
          {canManage ? (
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="lg"
                onClick={() => setAddOpen(true)}
                disabled={!currentOrganizationId}
              >
                <PlusIcon />
                Add member
              </Button>
            </div>
          ) : null}
        </header>
      </StickyHeader>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <DataTable
          fillHeight
          className="min-h-0 flex-1"
          columns={columns}
          rows={members}
          getRowKey={(member) => member.id}
          loading={isLoading}
          skeletonRows={3}
          empty={
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">No members yet</p>
                <p className="text-xs text-muted-foreground">
                  {canManage
                    ? "Add a teammate to give them access to this organization."
                    : "This organization has no other members."}
                </p>
              </div>
              {canManage ? (
                <Button
                  size="sm"
                  onClick={() => setAddOpen(true)}
                  disabled={!currentOrganizationId}
                >
                  <PlusIcon />
                  Add member
                </Button>
              ) : null}
            </div>
          }
        />
      )}

      <AddMemberDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={reload}
      />
      <RemoveMemberDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        member={removing}
        onRemoved={reload}
      />
    </div>
  )
}
