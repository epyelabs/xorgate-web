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

export const createProjectSchema = z.object({
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
  projectId: z.string(),
  deviceModelId: z.string(),
  serial: z.string(),
  name: z.string().nullable(),
  firmwareVersion: z.string().nullable(),
  simIccid: z.string().nullable(),
  status: deviceStatusSchema,
  lastSeenAt: z.string().nullable(),
  lastLatitude: z.string().nullable(),
  lastLongitude: z.string().nullable(),
  lastAccuracyM: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const listDevicesResponseSchema = z.object({
  devices: z.array(deviceSchema),
})

export const getDeviceResponseSchema = z.object({
  device: deviceSchema,
})

export type LoginInput = z.infer<typeof loginSchema>
export type SignupInput = z.infer<typeof signupSchema>
export type ConfirmSignupInput = z.infer<typeof confirmSignupSchema>
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>
export type CreateProjectInput = z.infer<typeof createProjectSchema>
