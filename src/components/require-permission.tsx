import type { ReactNode } from "react"
import { ForbiddenScreen } from "@/components/error-screens"
import { useHasPermission, type Permission } from "@/lib/permissions"

// Renders the 403 screen in place of the page when the caller's role doesn't
// carry `permission`. Deliberately a component rather than a beforeLoad
// redirect: the URL stays put, so a shared link still points at the page the
// user was denied and reloading after a role change just works.
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission
  children: ReactNode
}) {
  const allowed = useHasPermission(permission)
  if (!allowed) return <ForbiddenScreen permission={permission} />
  return <>{children}</>
}
