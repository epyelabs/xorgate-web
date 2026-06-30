import { z } from "zod"
import { runStatusSchema } from "./workflow-run-schemas"

// Schemas + types for device workflow attachments: a workflow template attached
// to a single device with a trigger. Distinct from WorkflowDeployment (workspace/
// template-scoped, in workflow-schemas.ts) and WorkflowRun (a single execution).
// These mirror the shapes the real `device_workflows` backend will return, so
// swapping the mock client in `device-workflows-api.ts` for `apiRequest` is a
// drop-in change validated by the same `.safeParse()` pattern used elsewhere.

// How an attached workflow decides to run. Surfaced to the user in the attach
// dialog; the open product question from the brief lives here.
export const attachmentTriggerSchema = z.enum([
  "manual", // run on demand, optionally over historical telemetry / a recording
  "recording_saved", // auto after a recording finishes on a chosen stream
  "telemetry_saved", // auto after persisted telemetry lands
  "schedule", // recurring (cron)
])

export const deviceWorkflowAttachmentSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  templateId: z.string(),
  templateName: z.string(),
  templateSlug: z.string(),
  pinnedVersion: z.number().nullable(), // null => follows the published version
  runningVersion: z.number(), // the resolved version that would actually run
  enabled: z.boolean(),
  trigger: attachmentTriggerSchema,
  triggerDetail: z.string(), // human summary: stream key / cron / "on save" / "—"
  lastRunAt: z.string().nullable(),
  lastRunStatus: runStatusSchema.nullable(),
  runCount: z.number(),
  createdAt: z.string(),
})

// Input for the attach dialog: which template, which version, which trigger.
export const attachWorkflowInputSchema = z.object({
  templateId: z.string().min(1, "Pick a workflow template"),
  pinnedVersion: z.number().nullable(), // null = follow published
  trigger: attachmentTriggerSchema,
  triggerDetail: z.string().default(""),
})

export const listDeviceAttachmentsResponseSchema = z.object({
  attachments: z.array(deviceWorkflowAttachmentSchema),
})

export type AttachmentTrigger = z.infer<typeof attachmentTriggerSchema>
export type DeviceWorkflowAttachment = z.infer<typeof deviceWorkflowAttachmentSchema>
export type AttachWorkflowInput = z.infer<typeof attachWorkflowInputSchema>
