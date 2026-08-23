import { z } from "zod"

// Form-validation schemas only. The API-response schemas that used to live
// here are gone: `@xorgate/sdk`'s typed responses replaced call-site response
// parsing (Phase 4 dogfood), and the live telemetry payload's validation
// moved into `@xorgate/react` with the feed itself.

// Shared pagination block returned by standardized list endpoints
// (see backend src/utils/list-params.ts). Still parsed by the workflow-plane
// schemas, whose endpoints are outside the SDK's modeled surface.
export const pageSchema = z.object({
  limit: z.number(),
  offset: z.number(),
  order: z.enum(["asc", "desc"]),
  total: z.number(),
  // Only /telemetry/readings sets these: its table is large enough that an
  // exact count times out, so `total` is capped at 10,000 addressable samples
  // and the covered span says which ones. Every other list endpoint counts an
  // exact total and omits them.
  totalIsCapped: z.boolean().optional(),
  coveredFrom: z.string().optional(),
  coveredTo: z.string().optional(),
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

// Settings form: the editable identity field. Empty name is allowed and sent
// as null. `status` deliberately absent — it is machine-managed (telemetry
// ingest / LWT) and the settings page only displays it.
export const updateDeviceSchema = z.object({
  name: z.string().max(80, "Name is too long"),
})
