import {
  createBootstrapClient,
  createClient,
  isXorgateError,
  type BootstrapClient,
  type DeviceUiPrefs,
  type ImuMountConfig,
  type RecordingConfig,
  type SessionStatus,
  type XorgateClient,
} from "@xorgate/sdk"
import { getIdToken } from "./cognito"

// Keep the env var a bare origin: the SDK appends `/v1` itself and refuses a
// baseUrl that already carries it (design note N6a).
const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string).replace(/\/$/, "")

// One auth object for every client. The SDK calls getToken per request and
// never caches it, so Cognito's own refresh logic stays in charge.
const AUTH = {
  getToken: async () => {
    const token = await getIdToken()
    if (!token) throw new Error("Not authenticated")
    return token
  },
}

// Tenancy seam. store/workspace.ts registers these at module scope, exactly as
// it did for the retired src/lib/api.ts — the store stays the single source of
// truth for the active org/workspace, and both this module and the
// XorgateProvider in main.tsx read from it.
let currentOrgIdGetter: () => string | null = () => null
let currentWorkspaceIdGetter: () => string | null = () => null

export function registerOrgIdGetter(fn: () => string | null) {
  currentOrgIdGetter = fn
}

export function registerWorkspaceIdGetter(fn: () => string | null) {
  currentWorkspaceIdGetter = fn
}

const bootstrap: BootstrapClient = createBootstrapClient({
  baseUrl: BASE_URL,
  auth: AUTH,
})

/**
 * Org-less client for the pre-org surface: `/me`, listing organizations, and
 * creating the first organization during onboarding.
 */
export function xgBootstrap(): BootstrapClient {
  return bootstrap
}

// Derived clients share one HttpCore, so re-deriving is cheap; memoizing the
// last (org, workspace) pair just keeps referential churn out of hot paths.
let cached: { org: string; ws: string | null; client: XorgateClient } | null =
  null

/**
 * The SDK client scoped to the CURRENT organization and workspace. Throws when
 * no organization is selected — same contract the old apiRequest had, where a
 * missing org simply omitted the header and the API refused.
 */
export function xg(): XorgateClient {
  const org = currentOrgIdGetter()
  if (!org) throw new Error("No organization selected")
  const ws = currentWorkspaceIdGetter()
  if (cached && cached.org === org && cached.ws === ws) return cached.client
  const client = createClient({
    baseUrl: BASE_URL,
    auth: AUTH,
    organizationId: org,
    ...(ws ? { workspaceId: ws } : {}),
  })
  cached = { org, ws, client }
  return client
}

/**
 * Human message for a toast. XorgateError.message is prefixed with
 * "CODE METHOD url: " for logs; strip that back off for the operator — the
 * replacement for the old apiErrorMessage's envelope unwrapping.
 */
export function xgMessage(err: unknown): string {
  if (isXorgateError(err)) {
    const prefix =
      err.method && err.url
        ? `${err.code} ${err.method} ${err.url}: `
        : `${err.code}: `
    return err.message.startsWith(prefix)
      ? err.message.slice(prefix.length)
      : err.message
  }
  return err instanceof Error ? err.message : String(err)
}

// ---------------------------------------------------------------------------
// Names the SDK does not export. Each is an alias over the SDK's own shape so
// there is exactly one definition; do not widen these locally.
// ---------------------------------------------------------------------------

export type ActiveStreamsViewType = NonNullable<
  DeviceUiPrefs["activeStreamsViewType"]
>
export type ImuView = NonNullable<DeviceUiPrefs["imuView"]>
export type ImuMount = ImuMountConfig
export type VideoPresetName = NonNullable<
  NonNullable<RecordingConfig["video"]>["preset"]
>
export type MediaSessionStatus = SessionStatus
