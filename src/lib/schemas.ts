import { z } from "zod"

// Shared pagination block returned by standardized list endpoints
// (see backend src/utils/list-params.ts).
export const pageSchema = z.object({
  limit: z.number(),
  offset: z.number(),
  order: z.enum(["asc", "desc"]),
  total: z.number(),
})

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
})

export const signupSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
})

export const confirmSignupSchema = z.object({
  email: z.string().email(),
  code: z.string().min(6, "Enter the 6-digit code from your email"),
})

export const meUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  tier: z.enum(["free", "pro", "team"]),
  role: z.enum(["user", "admin"]),
})

export const membershipSchema = z.object({
  id: z.string(),
  userId: z.string(),
  organizationId: z.string(),
  role: z.enum(["owner", "admin", "member", "viewer"]),
  createdAt: z.string(),
})

export const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const meResponseSchema = z.object({
  user: meUserSchema,
  memberships: z.array(membershipSchema),
  organizations: z.array(organizationSchema),
})

const slugField = z
  .string()
  .min(1, "Slug is required")
  .max(60, "Slug is too long")
  .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only")

export const createOrganizationSchema = z.object({
  name: z.string().min(1, "Name is required").max(80, "Name is too long"),
  slug: slugField,
})

export const createWorkspaceSchema = z.object({
  name: z.string().min(1, "Name is required").max(80, "Name is too long"),
  slug: slugField,
  description: z.string().max(280, "Description is too long").optional(),
})

export const membershipRoleSchema = z.enum([
  "owner",
  "admin",
  "member",
  "viewer",
])

// Add-member form: identify an existing user by email and assign a role.
export const addMemberSchema = z.object({
  email: z.string().email("Enter a valid email"),
  role: membershipRoleSchema,
})

export const apiKeyScopeSchema = z.enum(["edge", "cloud", "client"])

export const createApiKeySchema = z.object({
  name: z.string().min(1, "Name is required").max(80, "Name is too long"),
  scope: apiKeyScopeSchema,
})

export const deviceStatusSchema = z.enum([
  "provisioned",
  "online",
  "offline",
  "decommissioned",
])

// IMU mounting correction: how the sensor is physically rotated relative to
// the vehicle (ZYX euler, degrees). Mirrors the backend's devices.imu_mount.
export const imuMountSchema = z.object({
  enabled: z.boolean(),
  rollDeg: z.number(),
  pitchDeg: z.number(),
  yawDeg: z.number(),
})

// Camera direction for the 3D orientation view (degrees).
export const imuViewSchema = z.object({
  azimuthDeg: z.number(),
  elevationDeg: z.number(),
})

// On-device recording config (offline recording plan, D7). Mirrors backend
// devices.recording_config / device settings.json `recording`. Preset names
// are a closed table (backend src/schemas/recording-config.ts + device
// src/recording/video-presets.ts — change all together); .catch on the enum
// keeps an older client rendering when new presets ship.
export const videoPresetNameSchema = z.enum([
  "1080p30-4mbps",
  "1080p15-2mbps",
  "720p30-2mbps",
  "720p15-2mbps",
  "720p15-1mbps",
])

export const recordingConfigSchema = z.object({
  telemetry: z
    .object({ enabled: z.boolean().optional(), rateHz: z.number().optional() })
    .optional(),
  video: z
    .object({
      enabled: z.boolean().optional(),
      preset: videoPresetNameSchema.optional().catch(undefined),
      segmentSeconds: z.number().optional(),
      // Boot power staging (optimize-system-process-cycle plan, Phase 2).
      bootDefer: z.enum(["auto", "always", "off"]).optional().catch(undefined),
      bootDeferMaxSecs: z.number().optional(),
      bootDeferMinBudgetMa: z.number().optional(),
      // GPS/LTE video gate (Phase 7); gpsGateMaxSecs 0 = no time cap.
      gpsGate: z.enum(["auto", "always", "off"]).optional().catch(undefined),
      gpsGateMaxSecs: z.number().optional(),
      gpsGateNoProgressSecs: z.number().optional(),
      spawnStaggerSecs: z.number().optional(),
      // Per-camera enables keyed by stream key (Phase 6); absent key = enabled.
      cameras: z.record(z.string(), z.boolean()).optional().catch(undefined),
    })
    .optional(),
  upload: z.object({ mode: z.enum(["auto", "off"]).optional() }).optional(),
  retention: z
    .object({
      maxBytes: z.number().optional(),
      minFreeBytes: z.number().optional(),
    })
    .optional(),
  // Runtime undervoltage load shedding (optimize-system-process-cycle plan,
  // Phase 3). All thresholds are field-tunable device settings.
  powerShedding: z
    .object({
      enabled: z.boolean().optional(),
      uvSamples: z.number().optional(),
      uvWindowSecs: z.number().optional(),
      railLowVolts: z.number().optional(),
      railLowSecs: z.number().optional(),
      escalateDwellSecs: z.number().optional(),
      escalateDutyPct: z.number().optional(),
      restoreSecs: z.number().optional(),
      railRestoreVolts: z.number().optional(),
      maxShedsPerHour: z.number().optional(),
    })
    .optional(),
})

// LTE recovery policy (lte_gnss_recovery plan, R8). .catch(undefined) keeps an
// older client rendering when new policy/profile values ship.
export const lteRecoveryConfigSchema = z.object({
  gpsFixResetPolicy: z.enum(["defer", "veto-deadzone"]).optional().catch(undefined),
  deadZoneProfile: z
    .enum(["conservative", "balanced", "aggressive"])
    .optional()
    .catch(undefined),
})

// Offline time sources (optimize-system-process-cycle plan, Phase 4): GPS/NITZ
// clock stepping while NTP is unsynced. offlineSources=false is the kill switch.
export const timeSyncConfigSchema = z.object({
  offlineSources: z.boolean().optional().catch(undefined),
  stepThresholdSecs: z.number().optional().catch(undefined),
  maxStepsPerBoot: z.number().optional().catch(undefined),
})

export const deviceSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  deviceModelId: z.string(),
  serial: z.string(),
  name: z.string().nullable(),
  firmwareVersion: z.string().nullable(),
  status: deviceStatusSchema,
  // Tolerate an older backend that doesn't return the field yet.
  gnssAntBias: z.boolean().catch(false),
  // .catch keeps an older client forward-compatible when new view types ship.
  activeStreamsViewType: z.enum(["card", "map"]).catch("card"),
  // .catch(null) tolerates an older backend without the columns.
  imuMount: imuMountSchema.nullable().catch(null),
  imuView: imuViewSchema.nullable().catch(null),
  recordingConfig: recordingConfigSchema.nullable().catch(null),
  lteRecoveryConfig: lteRecoveryConfigSchema.nullable().catch(null),
  timeSyncConfig: timeSyncConfigSchema.nullable().catch(null),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const listDevicesResponseSchema = z.object({
  devices: z.array(deviceSchema),
  // Present on the standardized list endpoint; absent on older responses.
  page: pageSchema.optional(),
})

export const getDeviceResponseSchema = z.object({
  device: deviceSchema,
})

// Settings form: editable device fields. Empty name is allowed and sent as null.
export const updateDeviceSchema = z.object({
  name: z.string().max(80, "Name is too long"),
  status: deviceStatusSchema,
})

// --- IoT identity (settings): GET /devices/{id}/identity, non-secret metadata ---
export const deviceIdentitySchema = z.object({
  iotThingName: z.string(),
  certificateId: z.string(),
  policyName: z.string(),
  roleAlias: z.string(),
  status: z.string(),
  createdAt: z.string(),
})

export const getDeviceIdentityResponseSchema = z.object({
  identity: deviceIdentitySchema.nullable(),
})

// --- Device model capabilities (P2): drives which live widgets render ---
// Unknown nested fields (codec, maxWidth, …) are stripped — we only read what
// gates a widget. Note zod v4 `z.record` takes (keySchema, valueSchema).
export const ioCapabilitiesSchema = z.object({
  schemaVersion: z.number().optional(),
  media: z
    .object({
      video: z
        .array(z.object({ key: z.string(), label: z.string().optional() }))
        .optional(),
      audio: z.array(z.unknown()).optional(),
    })
    .optional(),
  sensors: z
    .object({
      imu: z
        .object({
          axes: z.array(z.string()).optional(), // legacy alias for accel
          accel: z.array(z.string()).optional(),
          quaternion: z.array(z.string()).optional(),
          euler: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  comm: z
    .object({
      module: z.string().optional(),
      gps: z.object({ fields: z.array(z.string()).optional() }).optional(),
      signal: z.object({ fields: z.array(z.string()).optional() }).optional(),
    })
    .optional(),
  system: z.object({ fields: z.array(z.string()).optional() }).optional(),
})

export const deviceModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string(),
  ioCapabilities: ioCapabilitiesSchema.nullable().optional(),
  firmwareChannel: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const getDeviceModelResponseSchema = z.object({
  device_model: deviceModelSchema,
})

// --- Live telemetry payload (P2): matches the device §1.3 contract over MQTT ---
const numericLeaf = z.object({ value: z.number(), unit: z.string().optional() })
const boolLeaf = z.object({ value: z.boolean() })

export const telemetryPayloadSchema = z.object({
  v: z.literal(1),
  deviceId: z.string(),
  ts: z.number(),
  seq: z.number().optional(),
  metrics: z.record(z.string(), z.record(z.string(), numericLeaf)).default({}),
  media: z
    .object({
      kvs: boolLeaf.optional(),
      recording: boolLeaf.optional(),
      // One entry per supervised KVS WebRTC master (per camera/channel).
      streams: z
        .array(
          z.object({
            streamKey: z.string(),
            channelName: z.string(),
            state: z.string(),
          }),
        )
        .optional(),
    })
    .optional()
    // Never let a media-shape change drop the whole telemetry payload: if `media`
    // fails to validate, treat it as absent and still surface metrics.
    .catch(undefined),
  // On-device recording status (offline recording plan, Phase 2). Mirrors the
  // device RecordingStatus and backend src/schemas/telemetry.ts — change all
  // three together. Same defensive posture as `media`: a shape change must
  // never drop the whole payload.
  recording: z
    .object({
      enabled: z.boolean(),
      sessionId: z.string().nullable(),
      backlogBytes: z.number(),
      backlogSegments: z.number(),
      droppedSegments: z.number(),
      uploading: z.boolean(),
      lastUploadAt: z.number().nullable(),
    })
    .optional()
    .catch(undefined),
})

// --- Live video (P3): KVS signaling channels from GET /devices/{id}/kvs-channels ---
export const kvsChannelSchema = z.object({
  streamKey: z.string(),
  channelName: z.string(),
  channelArn: z.string(),
  region: z.string(),
})

export const getKvsChannelsResponseSchema = z.object({
  channels: z.array(kvsChannelSchema),
})

// --- Device-recorded media sessions: GET /devices/{id}/sessions (Phase 4/5) ---
export const mediaSessionSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  streamKey: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  codec: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  fps: z.number().nullable(),
  bitrateKbps: z.number().nullable(),
  source: z.string().nullable(),
  // Advisory (a closed session reopens if a straggler segment lands).
  status: z.enum(["open", "closed"]).catch("open"),
  timeSource: z.string().nullable(),
  lastSegmentAt: z.string().nullable(),
  createdAt: z.string(),
  // Rollups, present on the list endpoint; default 0 on the segments
  // endpoint's embedded session.
  segmentCount: z.number().default(0),
  totalBytes: z.number().default(0),
  totalDurationMs: z.number().default(0),
})

export const mediaSegmentSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  sessionId: z.string(),
  streamKey: z.string(),
  s3Key: z.string(),
  seq: z.number(),
  startTs: z.string(),
  durationMs: z.number(),
  sizeBytes: z.number().nullable(),
  finalized: z.boolean().catch(true),
  uploadedAt: z.string(),
})

export const getDeviceSessionsResponseSchema = z.object({
  sessions: z.array(mediaSessionSchema),
  page: pageSchema.optional(),
})

export const getSessionSegmentsResponseSchema = z.object({
  session: mediaSessionSchema,
  segments: z.array(mediaSegmentSchema),
})

// --- Replay manifest: GET /devices/{id}/replay-manifest (composite replays
// plan, Phase 2). All timestamps are epoch MILLISECONDS (the replay-clock
// unit), unlike the ISO strings elsewhere.
export const replaySegmentSchema = z.object({
  seq: z.number(),
  startTs: z.number(),
  effectiveDurationMs: z.number(),
  finalized: z.boolean().catch(true),
  anchor: z.enum(["fstat", "computed", "boundary"]).nullable().catch(null),
  sizeBytes: z.number().nullable(),
  url: z.string(),
})

export const replayGapSchema = z.object({
  fromTs: z.number(),
  toTs: z.number(),
  reason: z.enum(["missing-segments", "evicted-head"]),
})

export const replaySessionSchema = z.object({
  id: z.string(),
  streamKey: z.string(),
  status: z.enum(["open", "closed"]).catch("open"),
  timeSource: z.string().nullable(),
  codec: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  fps: z.number().nullable(),
  segments: z.array(replaySegmentSchema),
  gaps: z.array(replayGapSchema),
})

export const replayManifestSchema = z.object({
  deviceId: z.string(),
  from: z.number(),
  to: z.number(),
  sessions: z.array(replaySessionSchema),
  urlExpiresAt: z.number(),
})

export const getReplayManifestResponseSchema = z.object({
  replay: replayManifestSchema,
})

// --- Telemetry history (P4): GET /devices/{id}/telemetry(+/latest) ---
export const telemetryReadingSchema = z.object({
  ts: z.string(),
  metric: z.string(),
  value: z.number().nullable(),
  unit: z.string().nullable(),
})

export const getTelemetryResponseSchema = z.object({
  readings: z.array(telemetryReadingSchema),
  bucketSeconds: z.number().nullable(),
  truncated: z.boolean(),
})

export const getTelemetryReadingsResponseSchema = z.object({
  readings: z.array(telemetryReadingSchema),
  page: pageSchema,
})

export const deviceLatestRowSchema = z.object({
  metric: z.string(),
  value: z.number().nullable(),
  unit: z.string().nullable(),
  ts: z.string(),
})

export const getTelemetryLatestResponseSchema = z.object({
  latest: z.array(deviceLatestRowSchema),
})

export type IoCapabilities = z.infer<typeof ioCapabilitiesSchema>
export type DeviceModel = z.infer<typeof deviceModelSchema>
export type TelemetryPayload = z.infer<typeof telemetryPayloadSchema>
export type KvsChannelData = z.infer<typeof kvsChannelSchema>
export type TelemetryReading = z.infer<typeof telemetryReadingSchema>

export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>
export type DeviceIdentityData = z.infer<typeof deviceIdentitySchema>

export type LoginInput = z.infer<typeof loginSchema>
export type SignupInput = z.infer<typeof signupSchema>
export type ConfirmSignupInput = z.infer<typeof confirmSignupSchema>
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>
export type AddMemberInput = z.infer<typeof addMemberSchema>
