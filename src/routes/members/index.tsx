import { useEffect, useMemo, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { RequirePermission } from "@/components/require-permission"
import { toast } from "sonner"
import { LogOutIcon, MoreHorizontalIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DestroyDialog } from "@/components/destroy-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { DataTable, type DataTableColumn } from "@/components/data-table"
import { StickyHeader } from "@/components/sticky-header"
import type { MembershipRole, MembershipWithUser } from "@xorgate/sdk"
import { xg, xgMessage } from "@/lib/xorgate"
import { useInvalidateMembers, useMembers } from "@/queries/org"
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

const ROLES: MembershipRole[] = ["owner", "admin", "member", "viewer"]

function MembersPage() {
  const [addOpen, setAddOpen] = useState(false)
  const [removing, setRemoving] = useState<MembershipWithUser | null>(null)
  // Handing the owner role over is confirmed in its own dialog; this holds
  // the member it names. Leaving the organization likewise.
  const [promoting, setPromoting] = useState<MembershipWithUser | null>(null)
  const [leaving, setLeaving] = useState(false)
  const navigate = useNavigate()

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

  // The org id lives in the query key, so an org switch reads (or starts)
  // that org's own cache entry; revisiting this page inside staleTime renders
  // instantly with no request.
  const membersQuery = useMembers()
  const isLoading = membersQuery.isPending
  const members = membersQuery.data ?? []
  const error =
    membersQuery.data || !membersQuery.error
      ? null
      : xgMessage(membersQuery.error)

  useEffect(() => {
    if (membersQuery.error && !membersQuery.data) {
      toast.error(xgMessage(membersQuery.error))
    }
  }, [membersQuery.error, membersQuery.data])

  const reload = useInvalidateMembers()
  const refreshMe = useAuthStore((s) => s.refreshMe)
  const ownMembership = members.find((m) => m.userId === authUserId) ?? null
  const ownerCount = members.filter((m) => m.role === "owner").length

  // Role changes short of `owner` are an admin's; granting `owner` (or
  // touching an owner at all) is the owner's alone. The API enforces both and
  // the last-owner rule; the menu just does not offer what would be refused.
  async function changeRole(member: MembershipWithUser, role: MembershipRole) {
    try {
      await xg().memberships.updateRole(member.id, role)
      toast.success(`${displayName(member)} is now ${ROLE_LABEL[role].toLowerCase()}`)
      reload()
      // Not our own row, but /me carries roles too and a new owner should see
      // the owner-only controls without a reload.
      void refreshMe()
    } catch (err) {
      toast.error(xgMessage(err))
    }
  }

  async function confirmPromote() {
    if (!promoting) return
    await changeRole(promoting, "owner")
    setPromoting(null)
  }

  /**
   * Leaving: remove our own membership. The store's auth subscriber notices
   * the organization gone from /me and re-points the selection at the next
   * one (or none); this page only has to get out of the way.
   */
  async function confirmLeave() {
    if (!ownMembership) return
    try {
      await xg().memberships.remove(ownMembership.id)
      toast.success("You left the organization")
      await refreshMe()
      void navigate({ to: "/", replace: true })
    } catch (err) {
      toast.error(xgMessage(err))
    }
  }

  const orgName =
    useAuthStore
      .getState()
      .organizations.find((o) => o.id === currentOrganizationId)?.name ??
    "this organization"

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
        const isSelf = member.userId === authUserId
        // Your own row offers exactly one thing: leaving. Everyone may leave,
        // except the last owner (the API refuses; hand over or delete first).
        if (isSelf) {
          const lastOwner = member.role === "owner" && ownerCount <= 1
          return (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={lastOwner}
              title={
                lastOwner
                  ? "You are the only owner. Make someone else an owner, or delete the organization."
                  : undefined
              }
              onClick={() => setLeaving(true)}
            >
              <LogOutIcon />
              Leave
            </Button>
          )
        }
        if (!canManage) return null
        // Admins cannot touch an owner's row at all; owners can.
        if (member.role === "owner" && callerRole !== "owner") return null
        const assignable = ROLES.filter(
          (r) => r !== member.role && (r !== "owner" || callerRole === "owner")
        )
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                aria-label={`Actions for ${displayName(member)}`}
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Change role</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {assignable.map((role) => (
                    <DropdownMenuItem
                      key={role}
                      onSelect={() =>
                        role === "owner"
                          ? setPromoting(member)
                          : void changeRole(member, role)
                      }
                    >
                      {ROLE_LABEL[role]}
                      {role === "owner" ? (
                        <span className="ml-auto text-xs text-muted-foreground">
                          confirm…
                        </span>
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setRemoving(member)}
              >
                <Trash2Icon />
                Remove from organization
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
      <DestroyDialog
        open={promoting !== null}
        onOpenChange={(open) => {
          if (!open) setPromoting(null)
        }}
        title={`Make ${promoting ? displayName(promoting) : "this member"} an owner?`}
        description={`They gain full control of ${orgName}, including deleting it and changing anyone's role — yours too.`}
        warning={
          <>
            <span className="font-medium text-foreground">
              Owners are equals.
            </span>{" "}
            You keep your own owner role; either of you can later demote the
            other or leave, as long as one owner remains.
          </>
        }
        confirmLabel="Make owner"
        pendingLabel="Updating…"
        onConfirm={confirmPromote}
      />
      <DestroyDialog
        open={leaving}
        onOpenChange={setLeaving}
        title={`Leave ${orgName}?`}
        description="You lose access to its workspaces, devices and recordings immediately. Your account is untouched."
        warning={
          <>
            <span className="font-medium text-foreground">
              Only an owner or admin can add you back.
            </span>{" "}
            {ownMembership?.role === "owner"
              ? "You give up your owner role; the remaining owners keep the organization."
              : null}
          </>
        }
        confirmLabel="Leave organization"
        pendingLabel="Leaving…"
        onConfirm={confirmLeave}
      />
    </div>
  )
}
