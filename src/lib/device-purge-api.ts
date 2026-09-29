import { xg } from "./xorgate"

// Device data purges (plans/device-wf-data-delete, Phase 2). Same shape as
// device-workflows-api.ts: raw `xg().request` calls against the core routes,
// so the page is not blocked on the SDK release that adds
// `xg().devices.purges.*`.
// TODO: switch to `@xorgate/sdk`'s DevicePurge / DevicePurgeScope /
// DevicePurgePreview types and `xg().devices.purges.*` once 0.10.0 is published.

export type DevicePurgeScope = "workflows" | "telemetry" | "media"

/** Every scope, in the order the dialog lists them and the worker runs them. */
export const DEVICE_PURGE_SCOPES: readonly DevicePurgeScope[] = [
  "workflows",
  "telemetry",
  "media",
]

export type DevicePurgeStatus = "queued" | "running" | "succeeded" | "failed"

/**
 * What the worker has deleted so far. `{}` until it claims the row, then all
 * nine keys (a scope that was not requested stays at 0).
 */
export type DevicePurgeCounts = Partial<{
  attachments: number
  runs: number
  runObjects: number
  telemetrySessions: number
  telemetryObjects: number
  readings: number
  ingestLogRows: number
  mediaSessions: number
  mediaObjects: number
}>

export type DevicePurge = {
  id: string
  deviceId: string
  workspaceId: string
  organizationId: string
  scopes: DevicePurgeScope[]
  status: DevicePurgeStatus
  /** Everything older than this goes; anything the device uploads after it survives. */
  cutoff: string
  /** The worker's resumable position; `step` names what it is doing now. */
  cursor: { step?: string; [key: string]: unknown } | null
  counts: DevicePurgeCounts
  error: string | null
  /** User id or API key id. */
  requestedBy: string
  requestedAt: string
  startedAt: string | null
  finishedAt: string | null
  leaseUntil: string | null
  /** `running` with a lease that expired long ago: the worker died mid-chunk. */
  stalled: boolean
}

export type DevicePurgePreview = {
  workflows: { attachments: number; runs: number }
  telemetry: {
    sessions: number
    /** Oldest and newest reading; both null when the device has none. */
    readingsFrom: string | null
    readingsTo: string | null
  }
  media: { sessions: number }
}

export const PURGE_IN_PROGRESS = "PURGE_IN_PROGRESS"

export async function previewDevicePurge(
  deviceId: string
): Promise<DevicePurgePreview> {
  return xg().request("GET", `/devices/${deviceId}/purges/preview`)
}

export async function createDevicePurge(
  deviceId: string,
  scopes: DevicePurgeScope[]
): Promise<{ purge: DevicePurge }> {
  return xg().request("POST", `/devices/${deviceId}/purges`, {
    body: { scopes },
  })
}

export async function getDevicePurge(
  deviceId: string,
  purgeId: string
): Promise<{ purge: DevicePurge }> {
  return xg().request("GET", `/devices/${deviceId}/purges/${purgeId}`)
}

/** Newest first; the API caps `limit` at 20. */
export async function listDevicePurges(
  deviceId: string,
  limit = 10
): Promise<{ purges: DevicePurge[] }> {
  return xg().request("GET", `/devices/${deviceId}/purges?limit=${limit}`)
}
