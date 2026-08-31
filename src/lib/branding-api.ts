import type { Organization, Workspace } from "@xorgate/sdk"
import { xg } from "./xorgate"

/**
 * Organization and workspace logos: the four `{id}/logo` routes.
 *
 * These go through the org-scoped SDK client's `request` escape hatch rather
 * than a typed resource method, for the same reason `lib/account-api.ts`
 * bypasses the SDK entirely: `@xorgate/sdk` is a PUBLISHED package pinned at
 * `^0.4.0` and does not model these routes yet. The escape hatch is enough
 * here — unlike the `/me` writes, these are org-scoped, so the client that
 * carries `X-Organization-Id` is the right one to send them.
 *
 * Fold them into typed resource methods when the SDK ships them; the shapes
 * below are deliberately the SDK's own types so that is a deletion.
 */

/**
 * Wider than the SDK's `Organization`/`Workspace` by exactly one field.
 * `logoUrl` is a presigned GET the API mints per response, so it is on the
 * wire but not in the published types yet.
 *
 * Workspaces reach the app through the SDK's generic `unwrap`, which passes
 * the row through verbatim, so the field really is present at runtime.
 * Organizations reach it through `account-api.fetchMe`, which maps the fields
 * it wants explicitly and carries this one across.
 */
export type BrandedOrganization = Organization & { logoUrl: string | null }
export type BrandedWorkspace = Workspace & { logoUrl: string | null }

export function uploadOrganizationLogo(
  organizationId: string,
  input: { contentType: string; data: string }
): Promise<{ organization: BrandedOrganization }> {
  return xg().request(
    "PUT",
    `/organizations/${encodeURIComponent(organizationId)}/logo`,
    { body: input }
  )
}

export function removeOrganizationLogo(
  organizationId: string
): Promise<{ organization: BrandedOrganization }> {
  return xg().request(
    "DELETE",
    `/organizations/${encodeURIComponent(organizationId)}/logo`
  )
}

export function uploadWorkspaceLogo(
  workspaceId: string,
  input: { contentType: string; data: string }
): Promise<{ workspace: BrandedWorkspace }> {
  return xg().request(
    "PUT",
    `/workspaces/${encodeURIComponent(workspaceId)}/logo`,
    { body: input }
  )
}

export function removeWorkspaceLogo(
  workspaceId: string
): Promise<{ workspace: BrandedWorkspace }> {
  return xg().request(
    "DELETE",
    `/workspaces/${encodeURIComponent(workspaceId)}/logo`
  )
}
