import { getIdToken } from "./cognito"

const API_URL = import.meta.env.VITE_API_BASE_URL as string

let currentOrgIdGetter: () => string | null = () => null
let currentWorkspaceIdGetter: () => string | null = () => null

export function registerOrgIdGetter(fn: () => string | null) {
  currentOrgIdGetter = fn
}

export function registerWorkspaceIdGetter(fn: () => string | null) {
  currentWorkspaceIdGetter = fn
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getIdToken()
  if (!token) throw new Error("Not authenticated")
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = "ApiError"
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = await authHeaders()
  const orgId = currentOrgIdGetter()
  if (orgId) headers["X-Organization-Id"] = orgId
  const workspaceId = currentWorkspaceIdGetter()
  if (workspaceId) headers["X-Workspace-Id"] = workspaceId
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...init.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new ApiError(res.status, text)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export type UserTier = "free" | "pro" | "team"
export type UserRole = "user" | "admin"
export type MembershipRole = "owner" | "admin" | "member" | "viewer"

export interface MeUser {
  id: string
  email: string
  name: string | null
  tier: UserTier
  role: UserRole
}

export interface Membership {
  id: string
  userId: string
  organizationId: string
  role: MembershipRole
  createdAt: string
}

export interface Organization {
  id: string
  name: string
  slug: string
  created_at: string
  updated_at: string
}

export interface Workspace {
  id: string
  organization_id: string
  name: string
  slug: string
  description: string | null
  created_at: string
  updated_at: string
}

export interface MeResponse {
  user: MeUser
  memberships: Membership[]
  organizations: Organization[]
}

export async function getMe(): Promise<MeResponse> {
  return apiRequest<MeResponse>("/me")
}

export async function listOrganizations(): Promise<{ organizations: Organization[] }> {
  return apiRequest("/organizations")
}

export async function createOrganization(input: {
  name: string
  slug: string
}): Promise<{ organization: Organization }> {
  return apiRequest("/organizations", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function listWorkspaces(): Promise<{ workspaces: Workspace[] }> {
  return apiRequest("/workspaces")
}

export async function createWorkspace(input: {
  name: string
  slug: string
  description?: string
}): Promise<{ workspace: Workspace }> {
  return apiRequest("/workspaces", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export type DeviceStatus =
  | "provisioned"
  | "online"
  | "offline"
  | "decommissioned"

export interface Device {
  id: string
  workspaceId: string
  deviceModelId: string
  serial: string
  name: string | null
  firmwareVersion: string | null
  status: DeviceStatus
  persistTelemetry: boolean
  autoRecord: boolean
  lastSeenAt: string | null
  createdAt: string
  updatedAt: string
}

export async function listDevices(): Promise<{ devices: Device[] }> {
  return apiRequest("/devices")
}

export async function getDevice(id: string): Promise<{ device: Device }> {
  return apiRequest(`/devices/${id}`)
}

// Update editable device fields (name / status / firmwareVersion). Maps to the
// backend PUT /devices/{id}; only provided keys are changed. `name: null` clears it.
export async function updateDevice(
  id: string,
  updates: {
    name?: string | null
    status?: DeviceStatus
    firmwareVersion?: string | null
    persistTelemetry?: boolean
    autoRecord?: boolean
  }
): Promise<{ device: Device }> {
  return apiRequest(`/devices/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  })
}

// Permanently delete a device. Backend returns 204 (no content).
export async function deleteDevice(id: string): Promise<void> {
  await apiRequest(`/devices/${id}`, { method: "DELETE" })
}

export interface IoCapabilities {
  schemaVersion?: number
  media?: {
    video?: { key: string; label?: string }[]
    audio?: unknown[]
  }
  sensors?: {
    imu?: {
      axes?: string[] // legacy alias for accel
      accel?: string[]
      quaternion?: string[]
      euler?: string[]
    }
  }
  comm?: {
    module?: string
    gps?: { fields?: string[] }
    signal?: { fields?: string[] }
  }
  system?: { fields?: string[] }
}

export interface DeviceModel {
  id: string
  name: string
  sku: string
  ioCapabilities: IoCapabilities | null
  firmwareChannel: string | null
  createdAt: string
  updatedAt: string
}

export async function getDeviceModel(
  id: string
): Promise<{ device_model: DeviceModel }> {
  return apiRequest(`/device-models/${id}`)
}

// Attaches the browser IoT policy to the caller's Cognito identity. Required
// before MQTT-over-WSS: AWS IoT authorizes Cognito identities via an attached
// IoT policy, not the IAM role. Idempotent.
export async function attachIotPolicy(): Promise<{
  attached: boolean
  identityId: string
  policyName: string
}> {
  return apiRequest("/iot/attach-policy", { method: "POST" })
}

// --- IoT identity (settings): non-secret X.509 identity metadata for a device ---
// The cert private key is never stored; certificateArn/credentialEndpoint are omitted
// server-side. `identity` is null when the device exists but isn't provisioned yet.
export interface DeviceIdentity {
  iotThingName: string
  certificateId: string
  policyName: string
  roleAlias: string
  status: string
  createdAt: string
}

export async function getDeviceIdentity(
  deviceId: string
): Promise<{ identity: DeviceIdentity | null }> {
  return apiRequest(`/devices/${deviceId}/identity`)
}

// --- Live video (P3): KVS WebRTC signaling channels for the browser viewer ---
export interface KvsChannel {
  streamKey: string
  channelName: string
  channelArn: string
  region: string
}

// Returns the device's KVS signaling channels (one per provisioned video stream).
// The browser mints its own scoped AWS creds via the Cognito identity pool — KVS
// uses standard IAM/SigV4 — so this endpoint returns channel metadata only.
// An empty array means the device is not provisioned yet.
export async function getKvsChannels(
  deviceId: string
): Promise<{ channels: KvsChannel[] }> {
  return apiRequest(`/devices/${deviceId}/kvs-channels`)
}

// --- Telemetry history (P4): reads over telemetry_readings + device_latest ---
export interface TelemetryReadingRow {
  ts: string
  metric: string
  value: number | null
  unit: string | null
}

export interface TelemetryHistoryResponse {
  readings: TelemetryReadingRow[]
  // Echo of `interval`; null when raw (un-bucketed) rows were returned.
  bucketSeconds: number | null
  // True when the server row cap was hit — narrow the range or coarsen interval.
  truncated: boolean
}

export async function getTelemetry(
  deviceId: string,
  params: { from: string; to: string; metric?: string; interval?: number }
): Promise<TelemetryHistoryResponse> {
  const qs = new URLSearchParams({ from: params.from, to: params.to })
  if (params.metric) qs.set("metric", params.metric)
  if (params.interval !== undefined) qs.set("interval", String(params.interval))
  return apiRequest(`/devices/${deviceId}/telemetry?${qs.toString()}`)
}

export interface DeviceLatestRow {
  metric: string
  value: number | null
  unit: string | null
  ts: string
}

export async function getTelemetryLatest(
  deviceId: string
): Promise<{ latest: DeviceLatestRow[] }> {
  return apiRequest(`/devices/${deviceId}/telemetry/latest`)
}

// --- Device registration (onboarding) ---
// The web app mints a short-lived code; the device's install.sh claims it
// (creating the device + its IoT identity) and the dialog polls until claimed.
export type RegistrationStatus = "pending" | "claimed" | "expired"

export interface DeviceRegistration {
  code: string
  status: RegistrationStatus
  deviceId: string | null
  expiresAt: string
  // Full URL to paste into the device: `${API_BASE}/get/${code}`.
  installUrl: string
}

// Mints (or reuses) a pending registration for the active org + workspace.
// Idempotent server-side: reloading the dialog returns the same code.
// Requires a selected workspace (X-Workspace-Id is sent automatically).
export async function createDeviceRegistration(): Promise<DeviceRegistration> {
  return apiRequest<DeviceRegistration>("/device-registrations", {
    method: "POST",
  })
}

export async function getDeviceRegistration(
  code: string
): Promise<DeviceRegistration> {
  return apiRequest<DeviceRegistration>(
    `/device-registrations/${encodeURIComponent(code)}`
  )
}

// --- Recordings: cloud viewer-recorder start/stop/list/playback/delete ---
export type RecordingStatus = "recording" | "stopping" | "completed" | "failed"
export type RecordingTrigger = "manual" | "auto"

export interface Recording {
  id: string
  deviceId: string
  streamKey: string
  status: RecordingStatus
  trigger: RecordingTrigger
  startedAt: string
  // Set by the recorder on its first received frame (via an IoT "capturing" signal).
  // null while 'recording' but not yet capturing (cold start) -> UI shows "Starting…".
  captureStartedAt: string | null
  endedAt: string | null
  s3Key: string | null
  sizeBytes: number | null
  durationMs: number | null
  taskArn: string | null
  createdAt: string
}

export async function getDeviceRecordings(
  deviceId: string
): Promise<{ recordings: Recording[] }> {
  return apiRequest(`/devices/${deviceId}/recordings`)
}

// Start recording one stream (cloud recorder joins the channel as a viewer).
export async function startRecording(
  deviceId: string,
  streamKey: string
): Promise<{ recording: Recording }> {
  return apiRequest(`/devices/${deviceId}/recordings`, {
    method: "POST",
    body: JSON.stringify({ streamKey }),
  })
}

// Start recording every provisioned stream on the device ("Record All").
export async function startAllRecordings(
  deviceId: string
): Promise<{ recordings: Recording[] }> {
  return apiRequest(`/devices/${deviceId}/recordings`, {
    method: "POST",
    body: JSON.stringify({ all: true }),
  })
}

export async function stopRecording(
  deviceId: string,
  recordingId: string
): Promise<{ recording: Recording }> {
  return apiRequest(`/devices/${deviceId}/recordings/${recordingId}/stop`, {
    method: "POST",
  })
}

// Presigned GET URL for browser playback (expires; fetch fresh when opening).
export async function getRecordingPlaybackUrl(
  deviceId: string,
  recordingId: string
): Promise<{ url: string; expiresIn: number }> {
  return apiRequest(`/devices/${deviceId}/recordings/${recordingId}/playback`)
}

export async function deleteRecording(
  deviceId: string,
  recordingId: string
): Promise<void> {
  await apiRequest(`/devices/${deviceId}/recordings/${recordingId}`, {
    method: "DELETE",
  })
}
