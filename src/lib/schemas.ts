import { z } from "zod"

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

export const deviceStatusSchema = z.enum([
  "provisioned",
  "online",
  "offline",
  "decommissioned",
])

export const deviceSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  deviceModelId: z.string(),
  serial: z.string(),
  name: z.string().nullable(),
  firmwareVersion: z.string().nullable(),
  status: deviceStatusSchema,
  persistTelemetry: z.boolean(),
  autoRecord: z.boolean(),
  lastSeenAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const listDevicesResponseSchema = z.object({
  devices: z.array(deviceSchema),
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

// --- Recordings: GET /devices/{id}/recordings ---
export const recordingSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  streamKey: z.string(),
  status: z.enum(["recording", "stopping", "completed", "failed"]),
  trigger: z.enum(["manual", "auto"]),
  // Why the recording ended (kvs-webrtc-lts §4.1). null while still recording or for
  // a natural EOS with no explicit reason. Nullable+optional so an older payload that
  // predates the column still validates.
  endReason: z.string().nullable().optional(),
  startedAt: z.string(),
  captureStartedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  s3Key: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  durationMs: z.number().nullable(),
  taskArn: z.string().nullable(),
  createdAt: z.string(),
})

export const getDeviceRecordingsResponseSchema = z.object({
  recordings: z.array(recordingSchema),
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
