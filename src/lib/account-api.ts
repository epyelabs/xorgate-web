import type { Membership, User } from "@xorgate/sdk"
import type { BrandedOrganization } from "./branding-api"
import { getIdToken } from "./cognito"

/**
 * The caller's own profile: `GET /me`, `PATCH /me` and the `/me/avatar` pair.
 *
 * These go straight to the API rather than through `@xorgate/sdk`, for two
 * reasons that both come down to the SDK being a PUBLISHED package pinned at
 * `^0.4.0`:
 *
 * 1. It models only `GET /me` on its org-less surface, and its bootstrap
 *    client has no `request` escape hatch the way the org-scoped one does, so
 *    the three writes have nothing to go through.
 * 2. Its `normalizeUser` builds a fresh object from six known keys, so it
 *    DROPS `avatarUrl` — the picture would never reach the app through it.
 *    That is why the bootstrap read lives here too (store/auth.ts), rather
 *    than being a second request layered on top of the SDK's.
 *
 * Every other call in the app still goes through the SDK. Fold these back in
 * when it ships a profile-aware `me()`; the shapes below are deliberately the
 * SDK's own types so that is a deletion, not a rewrite.
 */

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string).replace(/\/$/, "")

/**
 * The user block the `/me` operations answer with. Wider than the SDK's `User`
 * by exactly one field: `avatarUrl` is a presigned GET the API mints per
 * response, so it is on the wire but not in the published type yet.
 */
export type AccountUser = User & { avatarUrl: string | null }

async function request<T>(
  method: "GET" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  const token = await getIdToken()
  if (!token) throw new Error("Not authenticated")

  const response = await fetch(`${BASE_URL}/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  if (!response.ok) {
    // The API's uniform envelope is `{ error: { code, message } }`; fall back
    // to the status when a gateway answers with something else entirely.
    const payload = await response.json().catch(() => null)
    const message = (payload as { error?: { message?: string } } | null)?.error
      ?.message
    throw new Error(message ?? `Request failed (${response.status})`)
  }

  return (await response.json()) as T
}

/**
 * The wire shape of `GET /me`. Organizations serialize the Postgres row
 * verbatim, so their timestamps are snake_case here (the API's per-entity
 * casing; see the SDK's own note on it) and are normalized below.
 */
interface MeResponse {
  user: AccountUser
  memberships: Membership[]
  organizations: Array<
    Omit<BrandedOrganization, "createdAt" | "updatedAt"> & {
      created_at?: string
      updated_at?: string
    }
  >
}

export interface Me {
  user: AccountUser
  memberships: Membership[]
  organizations: BrandedOrganization[]
}

/** The bootstrap read: identity, memberships, and every organization. */
export async function fetchMe(): Promise<Me> {
  const body = await request<MeResponse>("GET", "/me")
  return {
    user: body.user,
    memberships: body.memberships,
    organizations: body.organizations.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      // Presigned and short-lived, like the user's `avatarUrl`: it comes back
      // fresh on every /me and is never persisted.
      logoUrl: org.logoUrl ?? null,
      createdAt: org.created_at ?? "",
      updatedAt: org.updated_at ?? "",
    })),
  }
}

/** `null` clears the name back to the email fallback. */
export function updateMe(input: {
  name: string | null
}): Promise<{ user: AccountUser }> {
  return request("PATCH", "/me", input)
}

export function uploadAvatar(input: {
  contentType: string
  data: string
}): Promise<{ user: AccountUser }> {
  return request("PUT", "/me/avatar", input)
}

export function removeAvatar(): Promise<{ user: AccountUser }> {
  return request("DELETE", "/me/avatar")
}

/**
 * `DELETE /me`: close the account. The API removes the Cognito user, the
 * profile and picture, every membership and the live-plane policy, and refuses
 * with `409 OWNS_ORGANIZATIONS` while the caller is the only owner of an
 * organization. The caller signs out afterwards; there is nothing to read back.
 */
export async function deleteMe(): Promise<void> {
  const token = await getIdToken()
  if (!token) throw new Error("Not authenticated")
  const response = await fetch(`${BASE_URL}/v1/me`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (response.status === 204) return
  const payload = (await response.json().catch(() => null)) as {
    error?: {
      code?: string
      message?: string
      details?: { organizations?: BlockingOrganization[] }
    }
  } | null
  if (response.status === 409 && payload?.error?.code === "OWNS_ORGANIZATIONS") {
    throw new OwnsOrganizationsError(payload.error.details?.organizations ?? [])
  }
  throw new Error(
    payload?.error?.message ?? `Request failed (${response.status})`
  )
}

export interface BlockingOrganization {
  id: string
  name: string
  slug: string
}

/**
 * `DELETE /me` refused because the caller is the only owner of these
 * organizations. Carried as data rather than prose so the account page can
 * link to each one instead of quoting the API's sentence back.
 */
export class OwnsOrganizationsError extends Error {
  readonly organizations: BlockingOrganization[]
  constructor(organizations: BlockingOrganization[]) {
    super(
      "Make someone else an owner of, or delete, the organizations you are the only owner of first"
    )
    this.name = "OwnsOrganizationsError"
    this.organizations = organizations
  }
}
