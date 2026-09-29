import { useAuthStore } from "@/store/auth"
import { useWorkspaceStore } from "@/store/workspace"
import type { MembershipRole } from "@xorgate/sdk"

// Route-level authorization is frontend-only for now: the backend does not
// enforce per-role access on these endpoints yet, so treat everything here as
// the UI half of a contract still to be written server-side. The role itself is
// real (it comes from the caller's membership in the active organization) —
// what's stubbed is the enforcement.

export type Permission =
  | "members:read"
  | "members:manage"
  | "api-keys:manage"
  // Webhook endpoints (register, rotate, test, redeliver) and a device's
  // webhook routes: owner/admin, the backend's own check. Every role reads.
  | "webhooks:manage"
  | "billing:manage"
  | "workspace:manage"
  // Giving a device away — owner/admin, matching every other destructive
  // device operation and the backend's own check. A member may edit a device
  // but must not hand it to another workspace or another organization.
  | "devices:transfer"
  // Models section (xorgate-models Q5): members annotate, import and build
  // versions; admins and owners start training and assist jobs (they cost
  // money) and archive or delete registry models; viewers read.
  | "models:annotate"
  | "models:train"
  | "models:manage"

const ALL_PERMISSIONS: Permission[] = [
  "members:read",
  "members:manage",
  "api-keys:manage",
  "webhooks:manage",
  "billing:manage",
  "workspace:manage",
  "devices:transfer",
  "models:annotate",
  "models:train",
  "models:manage",
]

const ROLE_PERMISSIONS: Record<MembershipRole, Permission[]> = {
  owner: ALL_PERMISSIONS,
  admin: [
    "members:read",
    "members:manage",
    "api-keys:manage",
    "webhooks:manage",
    "workspace:manage",
    "devices:transfer",
    "models:annotate",
    "models:train",
    "models:manage",
  ],
  member: ["members:read", "models:annotate"],
  viewer: [],
}

export const ROLE_LABEL: Record<MembershipRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
}

// Roles that satisfy a permission — used by the 403 screen to tell the user who
// to ask.
export function rolesWithPermission(permission: Permission): MembershipRole[] {
  return (Object.keys(ROLE_PERMISSIONS) as MembershipRole[]).filter((role) =>
    ROLE_PERMISSIONS[role].includes(permission)
  )
}

export function roleHasPermission(
  role: MembershipRole,
  permission: Permission
): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

const DEV_ROLE_KEY = "xorgate.devRole"

// Escape hatch for exercising the 403 path without a second account: set
// `localStorage.xorgate.devRole = "viewer"` in the console and reload. Ignored
// unless it names a real role, so a stale value can't wedge the app.
export function devRoleOverride(): MembershipRole | null {
  if (typeof localStorage === "undefined") return null
  const raw = localStorage.getItem(DEV_ROLE_KEY)
  return raw && raw in ROLE_PERMISSIONS ? (raw as MembershipRole) : null
}

// The caller's role in the active organization, or null while memberships
// haven't loaded (or the caller has none for this org).
export function useCurrentRole(): MembershipRole | null {
  const memberships = useAuthStore((s) => s.memberships)
  const currentOrganizationId = useWorkspaceStore(
    (s) => s.currentOrganizationId
  )
  const override = devRoleOverride()
  if (override) return override
  return (
    memberships.find((m) => m.organizationId === currentOrganizationId)?.role ??
    null
  )
}

export function useHasPermission(permission: Permission): boolean {
  const role = useCurrentRole()
  // Fail open on an unknown role. Memberships arrive from /me a beat after the
  // token does, and that request can fail outright — neither should lock a
  // legitimate user out of a page the backend would happily serve.
  if (!role) return true
  return roleHasPermission(role, permission)
}
