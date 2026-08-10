import { getIdToken } from "./cognito"
import { latestAgentBuildResponseSchema } from "./schemas"

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

// ApiError carries the raw response body, which for a backend error is the
// `{error:{code,message}}` envelope — dumping that into a toast shows the user
// JSON. Unwrap it back to the human message, falling back to the raw text for
// non-envelope bodies (gateway HTML, network failures).
export function apiErrorMessage(err: unknown): string {
  const raw = (err as Error)?.message ?? String(err)
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: unknown } }
    if (typeof parsed?.error?.message === "string") return parsed.error.message
  } catch {
    /* not an error envelope — use the raw text */
  }
  return raw
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

// The member's identity embedded in each roster row by GET /memberships.
export interface MembershipUser {
  id: string
  email: string
  name: string | null
}

// A membership enriched with its member's identity, as returned by
// GET /memberships. `user` is null only if the referenced user row is missing.
export interface OrgMember extends Membership {
  user: MembershipUser | null
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
  organizationId: string
  name: string
  slug: string
  description: string | null
  createdAt: string
  updatedAt: string
}

export type ApiKeyScope = "edge" | "cloud" | "client"

export interface ApiKey {
  id: string
  organizationId: string
  name: string
  scope: ApiKeyScope
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
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

// --- Organization members (roster) ---
export async function listMemberships(): Promise<{ memberships: OrgMember[] }> {
  return apiRequest("/memberships")
}

// Adds a member (by email) to the active organization. If the email has no
// account yet, the backend provisions a Cognito account and emails an
// invitation to set a password — `invited` is true in that case. Owner/admin
// only.
export async function addMembership(input: {
  email: string
  role: MembershipRole
}): Promise<{ membership: Membership; invited: boolean }> {
  return apiRequest("/memberships", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

// Removes a member from the active organization (owner/admin only). The backend
// refuses to remove the last owner. Returns 204 (no content).
export async function removeMembership(id: string): Promise<void> {
  await apiRequest<void>(`/memberships/${id}`, { method: "DELETE" })
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

export async function updateWorkspace(
  id: string,
  input: { name?: string; slug?: string; description?: string | null }
): Promise<{ workspace: Workspace }> {
  return apiRequest(`/workspaces/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  })
}

export async function deleteWorkspace(id: string): Promise<void> {
  await apiRequest<void>(`/workspaces/${id}`, { method: "DELETE" })
}

export async function listApiKeys(): Promise<{ api_keys: ApiKey[] }> {
  return apiRequest("/api-keys")
}

// The plaintext key is returned exactly once, at creation time.
export async function createApiKey(input: {
  name: string
  scope: ApiKeyScope
}): Promise<{ api_key: ApiKey; plaintext_key: string }> {
  return apiRequest("/api-keys", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function deleteApiKey(id: string): Promise<void> {
  await apiRequest<void>(`/api-keys/${id}`, { method: "DELETE" })
}

export type DeviceStatus =
  | "provisioned"
  | "online"
  | "offline"
  | "decommissioned"

// Pre-made layout the Active Streams tab renders. More views (and user-built
// layouts) come later; keep parsers forward-compatible.
export type ActiveStreamsViewType = "card" | "map"

// IMU mounting correction: how the sensor is physically rotated relative to
// the vehicle (ZYX euler, degrees). When enabled, the device agent publishes
// vehicle-frame euler angles; the raw quaternion stays sensor-frame.
export interface ImuMount {
  enabled: boolean
  rollDeg: number
  pitchDeg: number
  yawDeg: number
}

// Camera direction for the 3D orientation view (degrees). null = default.
export interface ImuView {
  azimuthDeg: number
  elevationDeg: number
}

// On-device recording config (offline recording plan, D7). Mirrors backend
// devices.recording_config; validated server-side against a closed preset
// table and delivered to the device as retained MQTT config. All fields
// optional (the device merges over its defaults); null on Device = never
// configured from the cloud.
export type VideoPresetName =
  | "1080p30-4mbps"
  | "1080p15-2mbps"
  | "720p30-2mbps"
  | "720p15-2mbps"
  | "720p15-1mbps"

export interface RecordingConfig {
  telemetry?: { enabled?: boolean; rateHz?: number }
  video?: {
    enabled?: boolean
    preset?: VideoPresetName
    segmentSeconds?: number
    // Boot power staging (optimize-system-process-cycle plan, Phase 2).
    bootDefer?: "auto" | "always" | "off"
    bootDeferMaxSecs?: number
    bootDeferMinBudgetMa?: number
    // GPS/LTE video gate (optimize-system-process-cycle plan, Phase 7): video
    // waits for the modem to finish acquiring. 0 = no time cap.
    gpsGate?: "auto" | "always" | "off"
    gpsGateMaxSecs?: number
    gpsGateNoProgressSecs?: number
    spawnStaggerSecs?: number
    // Per-camera capacity (optimize-system-process-cycle plan, Phase 6):
    // keyed by stream key; a disabled camera gets no pipeline at all. An
    // absent key means enabled, so {} is every detected camera.
    cameras?: Record<string, boolean>
  }
  upload?: { mode?: "auto" | "off" }
  retention?: { maxBytes?: number; minFreeBytes?: number }
  // Runtime undervoltage load shedding (optimize-system-process-cycle plan,
  // Phase 3): live streaming sheds first, recording last, hysteretic restore.
  powerShedding?: {
    enabled?: boolean
    uvSamples?: number
    uvWindowSecs?: number
    railLowVolts?: number
    railLowSecs?: number
    escalateDwellSecs?: number
    escalateDutyPct?: number
    /** Thermal arm (power_management_improvements Phase 1); edited on the Power settings tab. */
    cpuTempC?: number
    cpuTempRestoreC?: number
    cpuTempSecs?: number
    restoreSecs?: number
    railRestoreVolts?: number
    maxShedsPerHour?: number
  }
}

// LTE recovery policy (lte_gnss_recovery plan, R8): how aggressively the
// device's connection manager may use the GNSS-destructive full modem reset.
// Delivered to the device as retained MQTT config; the modem daemon reads it
// live at each recovery decision. Omitted fields = device safe defaults.
export interface LteRecoveryConfig {
  gpsFixResetPolicy?: "defer" | "veto-deadzone"
  deadZoneProfile?: "conservative" | "balanced" | "aggressive"
}

// Offline time sources (optimize-system-process-cycle plan, Phase 4): while
// NTP is unsynced this boot, the agent may step the system clock from GPS or
// the modem's NITZ time. Delivered to the device as retained MQTT config; the
// agent's clock stepper reads it live. Omitted fields = device defaults
// (stepping on, 10 s threshold, 4 steps/boot).
export interface TimeSyncConfig {
  offlineSources?: boolean
  stepThresholdSecs?: number
  maxStepsPerBoot?: number
}

// Cellular data context (manage_sim_card_info plan, Phase 2). `apn` empty or
// absent leaves the modem's stored APN untouched — the safe default for every
// fielded device. A non-empty APN is applied by the modem daemon with
// confirm-and-rollback; the device reports the APPLIED value back in
// `reportedConfig.effective.apn`.
export interface CellularConfig {
  apn?: string
}

// The consolidated device config document (backend `devices.config`), one key
// per wire namespace. An ABSENT namespace means the device uses its own
// defaults — the same semantics the retained MQTT message has always had.
export interface DeviceConfigDocument {
  gnssAntBias?: boolean
  imuMount?: ImuMount
  recording?: RecordingConfig
  lteRecovery?: LteRecoveryConfig
  timeSync?: TimeSyncConfig
  cellular?: CellularConfig
}

// Cloud-only presentation prefs (backend `devices.ui_prefs`). Never delivered
// to the device and never bumps configRev.
export interface DeviceUiPrefs {
  activeStreamsViewType?: ActiveStreamsViewType
  imuView?: ImuView
}

export interface Device {
  id: string
  workspaceId: string
  deviceModelId: string
  serial: string
  name: string | null
  /**
   * Installed xorgate-device-agent build (CI short sha on dev, release tag on
   * prod). Read-only: the backend mirrors it from the device's config report,
   * and there is no write path. null until the device reports a build.
   */
  agentVersion: string | null
  status: DeviceStatus
  /** Everything delivered to the device, in one document. */
  config: DeviceConfigDocument
  /**
   * Monotonic config revision, bumped on every config write and carried on the
   * retained MQTT message as `rev`. Phase 3 compares it with the device's
   * reported rev to compute pending/applied.
   */
  configRev: number
  configUpdatedAt: string | null
  uiPrefs: DeviceUiPrefs
  /** Last device report of what it actually applied (Phase 3). */
  reportedConfig: Record<string, unknown> | null
  reportedAt: string | null
  // ⚠️ TRANSITION WINDOW: the pre-consolidation top-level fields. The backend
  // dual-writes them, and the settings tabs still READ them (that is what kept
  // the Phase 2 adapter to one file). A follow-up migration drops the columns;
  // move the reads onto `config`/`uiPrefs` before then.
  gnssAntBias: boolean
  activeStreamsViewType: ActiveStreamsViewType
  imuMount: ImuMount | null
  imuView: ImuView | null
  recordingConfig: RecordingConfig | null
  lteRecoveryConfig: LteRecoveryConfig | null
  timeSyncConfig: TimeSyncConfig | null
  lastSeenAt: string | null
  createdAt: string
  updatedAt: string
}

export interface DevicesListParams {
  limit?: number
  offset?: number
  order?: "asc" | "desc"
  sort?: "updatedAt" | "createdAt" | "lastSeenAt" | "serial" | "name"
  status?: DeviceStatus
}

export async function listDevices(
  params: DevicesListParams = {}
): Promise<{ devices: Device[]; page?: Page }> {
  const qs = new URLSearchParams()
  if (params.limit !== undefined) qs.set("limit", String(params.limit))
  if (params.offset !== undefined) qs.set("offset", String(params.offset))
  if (params.order) qs.set("order", params.order)
  if (params.sort) qs.set("sort", params.sort)
  if (params.status) qs.set("status", params.status)
  const suffix = qs.toString() ? `?${qs.toString()}` : ""
  return apiRequest(`/devices${suffix}`)
}

export async function getDevice(id: string): Promise<{ device: Device }> {
  return apiRequest(`/devices/${id}`)
}

// Update device METADATA. Maps to the backend PUT /devices/{id}; only provided
// keys are changed, `name: null` clears it. Device config no longer travels
// here — it goes through patchDeviceConfig / patchDeviceUiPrefs below. `status`
// and `lastSeenAt` are machine-managed and rejected 400 by the API.
export async function updateDevice(
  id: string,
  updates: {
    name?: string | null
  }
): Promise<{ device: Device }> {
  return apiRequest(`/devices/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  })
}

// Write one or more config namespaces. Each present namespace is validated and
// replaced WHOLE (the device merges the same way, so a partial namespace would
// drop the keys it omits), the whole document is published to the device as a
// retained MQTT message, and configRev is bumped. `null` reverts a namespace to
// the device's own defaults. All-or-nothing: an invalid namespace 400s and
// nothing is committed.
export type DeviceConfigPatch = {
  [K in keyof DeviceConfigDocument]?: DeviceConfigDocument[K] | null
}

export async function patchDeviceConfig(
  id: string,
  patch: DeviceConfigPatch
): Promise<{ device: Device }> {
  return apiRequest(`/devices/${id}/config`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

// Write cloud-only presentation prefs. Nothing here reaches the device and
// configRev is not bumped. `null` resets a pref to its default.
export type DeviceUiPrefsPatch = {
  [K in keyof DeviceUiPrefs]?: DeviceUiPrefs[K] | null
}

export async function patchDeviceUiPrefs(
  id: string,
  patch: DeviceUiPrefsPatch
): Promise<{ device: Device }> {
  return apiRequest(`/devices/${id}/ui-prefs`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

// Permanently delete a device. Backend returns 204 (no content).
export async function deleteDevice(id: string): Promise<void> {
  await apiRequest(`/devices/${id}`, { method: "DELETE" })
}

export interface DeviceCommandAccepted {
  requestId: string
  command: "reboot" | "power_off" | "refresh" | "update"
  /** Epoch ms after which the device refuses the command. */
  expiresAt: number
}

// One-shot device commands (owner/admin only; the device must be online, else
// the backend returns 409). Both return 202 as soon as the command reaches the
// MQTT broker — that is NOT confirmation the device acted on it. The real
// signal is the device's status going offline and (for reboot) back online.
export async function rebootDevice(id: string): Promise<DeviceCommandAccepted> {
  return apiRequest(`/devices/${id}/reboot`, { method: "POST" })
}

export async function powerOffDevice(id: string): Promise<DeviceCommandAccepted> {
  return apiRequest(`/devices/${id}/power-off`, { method: "POST" })
}

// READ-ONLY refresh (manage_sim_card_info plan, Phase 2 §4d): the device
// re-probes SIM identity / applied APN / antenna bias and publishes a fresh
// config report now instead of on its hourly heartbeat. Ordinary member
// access. 202 = delivered to the broker; the outcome is a fresh
// `reportedAt` on the device row (~a few seconds for the report-now half,
// up to ~45 s for re-probed values). The device rate-limits to ~1 per 30 s.
export async function refreshDeviceState(id: string): Promise<DeviceCommandAccepted> {
  return apiRequest(`/devices/${id}/refresh-state`, { method: "POST" })
}

// Install the latest published agent build (device_update_management, Phase 3).
// Owner/admin, device must be online (409 otherwise). Latest-only — there is no
// version parameter, by design.
//
// 202 means the command reached the broker, and unlike reboot there is no
// status flip to wait on that means "done": the device drops offline for a
// minute or two, comes back, and the ONLY evidence of success is a changed
// build in its next report. Poll `getDevice` and compare
// `reportedAgentBuild(device)?.version` (or `device.agentVersion`) with what it
// was before. Pressing twice is harmless — the device-side one-shot coalesces.
export async function updateDeviceAgent(id: string): Promise<DeviceCommandAccepted> {
  return apiRequest(`/devices/${id}/update`, { method: "POST" })
}

/** The newest build published for this stage, from `GET /device-dist/latest`. */
export interface LatestAgentBuild {
  version: string
  channel: string | null
  builtAt: string | null
  packageVersion: string | null
}

// What a device update would install. Returns null when the stage has no
// published manifest yet (404) — "latest unknown", not an error: the update
// action still works, it just cannot advertise that an update is available.
// Compare with the installed version by STRING EQUALITY only; shas do not
// order.
export async function getLatestAgentBuild(): Promise<LatestAgentBuild | null> {
  let raw: unknown
  try {
    raw = await apiRequest<unknown>("/device-dist/latest")
  } catch (err) {
    if ((err as ApiError).status === 404) return null
    throw err
  }
  const parsed = latestAgentBuildResponseSchema.safeParse(raw)
  return parsed.success ? parsed.data.latest : null
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

// The most recent `limit` readings (newest by ts), optionally filtered to a set
// of metrics. Unlike getTelemetry this takes no time window, so callers see the
// latest samples even if the device last reported long ago. Same response shape
// as getTelemetry (readings ascending by ts).
export async function getTelemetryRecent(
  deviceId: string,
  params: { metric?: string; limit?: number } = {}
): Promise<TelemetryHistoryResponse> {
  const qs = new URLSearchParams()
  if (params.metric) qs.set("metric", params.metric)
  if (params.limit !== undefined) qs.set("limit", String(params.limit))
  const suffix = qs.toString() ? `?${qs.toString()}` : ""
  return apiRequest(`/devices/${deviceId}/telemetry/recent${suffix}`)
}

// Pagination block for /telemetry/readings. Unlike the other list endpoints,
// this one cannot afford an exact count (see backend
// services/telemetry-readings.ts), so `total` is bounded and says so.
export interface TelemetryReadingsPageMeta {
  limit: number
  offset: number
  order: "asc" | "desc"
  // Distinct timestamps (samples) the pager can ADDRESS under this filter —
  // bounded at 10 000, not the true match count. See `totalIsCapped`.
  total: number
  // Always sent by this endpoint (false when `total` is exact); the other list
  // endpoints omit all three, hence optional.
  totalIsCapped?: boolean
  // ISO bounds of the addressable slice. Omitted when nothing matches. Render
  // these — never derive a span from the cap; how long 10 000 samples covers
  // depends entirely on how densely the device reported.
  coveredFrom?: string
  coveredTo?: string
}

// One page of the Telemetry History table, assembled server-side (`shape=table`,
// the endpoint's default). Unlike getTelemetry (which averages into buckets),
// these are the actual stored samples, paginated over distinct timestamps.
export interface TelemetryTablePage {
  // Ordered — the array order IS the column order.
  columns: { key: string; unit: string | null }[]
  rows: {
    ts: string
    // POSITIONAL against `columns`, always exactly columns.length long.
    // null = no reading for that column at this timestamp.
    v: (number | null)[]
  }[]
  // "model"/"request" = an authoritative column set, stable across pages.
  // "data" = the device model declares nothing, so columns were discovered from
  // this page's rows and may change as you page.
  columnSource: "request" | "model" | "data"
  page: TelemetryReadingsPageMeta
}

// The same page in the raw-rows shape (`shape=flat`) — the generic contract
// shared with /telemetry and /telemetry/recent.
//
// ⚠ No screen calls this any more: the table and the CSV export both moved to
// getTelemetryTable. It is kept because `shape=flat` is a supported, documented
// part of the public API (API-key consumers may depend on it), so this stays as
// its maintained, typechecked client. Delete it only with the endpoint.
export interface TelemetryReadingsPage {
  readings: TelemetryReadingRow[]
  page: TelemetryReadingsPageMeta
}

interface TelemetryReadingsParams {
  limit?: number
  offset?: number
  order?: "asc" | "desc"
  from?: string
  to?: string
  metric?: string
}

function readingsQuery(params: TelemetryReadingsParams): URLSearchParams {
  const qs = new URLSearchParams()
  if (params.limit !== undefined) qs.set("limit", String(params.limit))
  if (params.offset !== undefined) qs.set("offset", String(params.offset))
  if (params.order) qs.set("order", params.order)
  if (params.from) qs.set("from", params.from)
  if (params.to) qs.set("to", params.to)
  if (params.metric) qs.set("metric", params.metric)
  return qs
}

// `shape=table` is the server default, but send it explicitly: this call site
// parses the table shape and should not silently change meaning if the default
// ever moves again.
export async function getTelemetryTable(
  deviceId: string,
  params: TelemetryReadingsParams = {}
): Promise<TelemetryTablePage> {
  const qs = readingsQuery(params)
  qs.set("shape", "table")
  return apiRequest(`/devices/${deviceId}/telemetry/readings?${qs.toString()}`)
}

export async function getTelemetryReadings(
  deviceId: string,
  params: TelemetryReadingsParams = {}
): Promise<TelemetryReadingsPage> {
  const qs = readingsQuery(params)
  qs.set("shape", "flat")
  return apiRequest(`/devices/${deviceId}/telemetry/readings?${qs.toString()}`)
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

// Standard pagination block returned by list endpoints (see backend
// src/utils/list-params.ts).
export interface Page {
  limit: number
  offset: number
  order: "asc" | "desc"
  total: number
}

// --- Device-recorded media sessions (offline recording plan, Phase 4/5) ---
// Recorded ON the device and uploaded segment-by-segment. `status` is advisory:
// a session closes ~10 min after segments stop arriving and reopens if a
// straggler lands.
export type MediaSessionStatus = "open" | "closed"

export interface MediaSession {
  id: string
  deviceId: string
  streamKey: string
  startedAt: string
  endedAt: string | null
  codec: string | null
  width: number | null
  height: number | null
  fps: number | null
  bitrateKbps: number | null
  source: string | null
  status: MediaSessionStatus
  // Device clock quality at session start (ntp | rtc | unsynced); "unsynced"
  // timestamps may be wrong wall-clock.
  timeSource: string | null
  lastSegmentAt: string | null
  createdAt: string
  // Rollups (list endpoint only; computed per page).
  segmentCount: number
  totalBytes: number
  totalDurationMs: number
}

export interface MediaSegment {
  id: string
  deviceId: string
  sessionId: string
  streamKey: string
  s3Key: string
  seq: number
  startTs: string
  durationMs: number
  sizeBytes: number | null
  // false = crash-cut partial (playable up to the cut).
  finalized: boolean
  uploadedAt: string
}

export interface MediaSessionsListParams {
  limit?: number
  offset?: number
  order?: "asc" | "desc"
  sort?: "startedAt" | "createdAt"
  status?: MediaSessionStatus
  streamKey?: string
  // Matches sessions OVERLAPPING [from, to), not just those started inside it.
  from?: string
  to?: string
}

// A run as the API returns it (`?group=runs`). ISO timestamps — the sessions
// dialect. `runFromApi` (lib/replay/runs.ts) turns this into the epoch-ms
// `RecordingRun` the replay helpers read.
export interface ApiRecordingRun {
  key: string
  fromTs: string
  toTs: string
  streamKeys: string[]
  sessionCount: number
  segmentCount: number
  totalBytes: number
  anyOpen: boolean
  anyUnsynced: boolean
  sessions: MediaSession[]
}

function sessionsQuery(params: MediaSessionsListParams): string {
  const qs = new URLSearchParams()
  if (params.limit !== undefined) qs.set("limit", String(params.limit))
  if (params.offset !== undefined) qs.set("offset", String(params.offset))
  if (params.order) qs.set("order", params.order)
  if (params.sort) qs.set("sort", params.sort)
  if (params.status) qs.set("status", params.status)
  if (params.streamKey) qs.set("streamKey", params.streamKey)
  if (params.from) qs.set("from", params.from)
  if (params.to) qs.set("to", params.to)
  return qs.toString() ? `?${qs.toString()}` : ""
}

export async function getDeviceSessions(
  deviceId: string,
  params: MediaSessionsListParams = {}
): Promise<{ sessions: MediaSession[]; page?: Page }> {
  return apiRequest(`/devices/${deviceId}/sessions${sessionsQuery(params)}`)
}

// Same endpoint, grouped: the server clusters the device's sessions into
// recording runs and paginates THOSE, so a run can never straddle a page
// boundary and `page.total` counts runs. Filters select which runs to return,
// not which sessions to cluster — `streamKey=cam0` yields the runs cam0
// recorded in, every camera still present.
export async function getDeviceRuns(
  deviceId: string,
  params: MediaSessionsListParams = {}
): Promise<{ runs: ApiRecordingRun[]; page?: Page }> {
  const qs = sessionsQuery(params)
  return apiRequest(
    `/devices/${deviceId}/sessions${qs ? `${qs}&` : "?"}group=runs`
  )
}

// The whole ordered segment index in one response (seq asc = chronological).
export async function getSessionSegments(
  deviceId: string,
  sessionId: string
): Promise<{ session: MediaSession; segments: MediaSegment[] }> {
  return apiRequest(`/devices/${deviceId}/sessions/${sessionId}/segments`)
}

// Deletes the session's segment objects from storage and its index rows
// (owner/admin only — device-recorded sessions are not re-creatable). A
// straggler segment still uploading from the device recreates the session.
export async function deleteDeviceSession(
  deviceId: string,
  sessionId: string
): Promise<void> {
  await apiRequest(`/devices/${deviceId}/sessions/${sessionId}`, {
    method: "DELETE",
  })
}

// Presigned GET URL for one segment (1 h TTL; fetch fresh when opening).
export async function getSegmentPlaybackUrl(
  deviceId: string,
  sessionId: string,
  seq: number
): Promise<{ url: string; expiresIn: number; segment: MediaSegment }> {
  return apiRequest(
    `/devices/${deviceId}/sessions/${sessionId}/segments/${seq}/playback`
  )
}

// --- Replay manifest (composite replays plan, Phase 2) ---
// One response with everything a replay player needs: per-session gap-aware
// timelines + a presigned GET URL per segment. Unlike the rest of this API,
// all RESPONSE timestamps are epoch milliseconds (the replay-clock unit);
// query from/to stay ISO-8601.

export interface ReplaySegment {
  seq: number
  startTs: number
  // Next-segment startTs delta when contiguous, else the recorded durationMs
  // (deltas beat durations — R2). Segment covers [startTs, startTs + this).
  effectiveDurationMs: number
  // false = crash-cut partial; playable up to the cut.
  finalized: boolean
  // startTs provenance; "fstat" seq-0 rows include ~2 s of pipeline startup,
  // so the first seam may hold a ~2 s buffered hole (player gap-jumps it).
  anchor: "fstat" | "computed" | "boundary" | null
  sizeBytes: number | null
  url: string
}

export interface ReplayGap {
  fromTs: number
  toTs: number
  reason: "missing-segments" | "evicted-head"
}

export interface ReplaySession {
  id: string
  streamKey: string
  status: MediaSessionStatus
  // "unsynced" = wall-clock correlation with telemetry is untrustworthy.
  timeSource: string | null
  codec: string | null
  width: number | null
  height: number | null
  fps: number | null
  // Ordered by startTs. Empty (with empty gaps) when the session's media
  // expired via the 90 d lifecycle — telemetry-only replay, not an error.
  segments: ReplaySegment[]
  gaps: ReplayGap[]
}

export interface ReplayManifest {
  deviceId: string
  from: number
  to: number
  sessions: ReplaySession[]
  // Epoch ms after which segment URLs may stop working (real TTL minus a
  // safety margin) — refetch the manifest before this.
  urlExpiresAt: number
}

export type ReplayManifestParams =
  | { sessionId: string }
  | { from: string; to: string; streamKey?: string }

export async function getReplayManifest(
  deviceId: string,
  params: ReplayManifestParams
): Promise<{ replay: ReplayManifest }> {
  const qs = new URLSearchParams()
  if ("sessionId" in params) {
    qs.set("sessionId", params.sessionId)
  } else {
    qs.set("from", params.from)
    qs.set("to", params.to)
    if (params.streamKey) qs.set("streamKey", params.streamKey)
  }
  return apiRequest(`/devices/${deviceId}/replay-manifest?${qs.toString()}`)
}
