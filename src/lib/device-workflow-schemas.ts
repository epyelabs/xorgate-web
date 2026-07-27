import { z } from "zod"
import { runStatusSchema } from "./workflow-run-schemas"
import { metricLabel } from "./telemetry-meta"

// Schemas + types for device workflow attachments: a workflow template attached
// to a single device with one or more triggers. Distinct from WorkflowDeployment
// (workspace/template-scoped, in workflow-schemas.ts) and WorkflowRun (a single
// execution). These mirror the shapes the real `device_workflows` backend will
// return, so swapping the mock client in `device-workflows-api.ts` for
// `apiRequest` is a drop-in change validated by the same `.safeParse()` pattern
// used elsewhere.

// The discriminator for a trigger. Drives the badge/icon in the attachments
// table and the "Add trigger" menu. `manual` and `telemetry_saved` were dropped:
// manual survives only as the ad-hoc "Run now" action, not a configured trigger.
export const attachmentTriggerTypeSchema = z.enum([
  "session_completed", // auto after a device-recorded session finishes uploading
  "segment_uploaded", // auto per ~60s chunk, as each one lands (near-realtime)
  "schedule", // recurring (cron) over a chosen telemetry / media context window
  "telemetry_condition", // when persisted telemetry crosses configured thresholds
])

// Comparison used by a telemetry condition row.
export const conditionOperatorSchema = z.enum([
  "gt",
  "gte",
  "lt",
  "lte",
  "eq",
  "neq",
])

// Human-facing symbol for each operator (shared by the builder UI + summaries).
export const OPERATOR_SYMBOL: Record<
  z.infer<typeof conditionOperatorSchema>,
  string
> = {
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  eq: "=",
  neq: "≠",
}

// Short label for each trigger type (shared by the sheet menu + table badge).
export const TRIGGER_TYPE_LABELS: Record<
  z.infer<typeof attachmentTriggerTypeSchema>,
  string
> = {
  session_completed: "After an on-device session completes",
  segment_uploaded: "As each recorded chunk arrives",
  schedule: "On a schedule",
  telemetry_condition: "On telemetry condition",
}

export const telemetryConditionSchema = z.object({
  metric: z.string().min(1, "Pick a metric"), // e.g. "gps.speed" (METRIC_LABELS key)
  operator: conditionOperatorSchema,
  value: z.number(),
})

// The data window a scheduled run pulls, configured per data type (telemetry /
// media). One of: everything accumulated since the previous scheduled run (the
// default), an absolute date-time range, or a relative "last N".
export const contextWindowSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("sinceLastRun"), // from the previous scheduled run to now
  }),
  z.object({
    mode: z.literal("range"),
    from: z.string().min(1, "Pick a start"), // ISO / datetime-local string
    to: z.string().min(1, "Pick an end"),
  }),
  z.object({
    mode: z.literal("lastN"),
    n: z.number().int().positive("Enter a positive count"),
  }),
])

// How an attached workflow decides to run. An attachment holds one or more of
// these; a run fires when ANY of them matches.
export const attachmentTriggerSchema = z.discriminatedUnion("type", [
  // Fires when the cloud closes a device-recorded media session (~10 min after
  // its last segment arrives). AT-LEAST-ONCE: a straggler segment reopens the
  // session and it fires again on re-close. The run processes the WHOLE
  // session — the batch half of the media trigger pair.
  z.object({
    type: z.literal("session_completed"),
    streamKeys: z.array(z.string()).min(1, "Pick at least one stream"),
  }),
  // The near-realtime half: fires once per ~60 s chunk as it lands, so the run
  // sees that chunk only. Latency is roughly one chunk instead of the session
  // close window.
  z.object({
    type: z.literal("segment_uploaded"),
    streamKeys: z.array(z.string()).min(1, "Pick at least one stream"),
  }),
  z.object({
    type: z.literal("schedule"),
    cron: z.string().min(1, "Enter a cron expression"),
    telemetryContext: contextWindowSchema,
    mediaContext: contextWindowSchema,
  }),
  z.object({
    type: z.literal("telemetry_condition"),
    combinator: z.enum(["and", "or"]),
    conditions: z.array(telemetryConditionSchema).min(1, "Add a condition"),
  }),
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
  triggers: z.array(attachmentTriggerSchema), // one badge per trigger in the table
  lastRunAt: z.string().nullable(),
  lastRunStatus: runStatusSchema.nullable(),
  runCount: z.number(),
  createdAt: z.string(),
})

// Input for the attach sheet: which template, which version, which triggers.
export const attachWorkflowInputSchema = z.object({
  templateId: z.string().min(1, "Pick a workflow template"),
  pinnedVersion: z.number().nullable(), // null = follow published
  triggers: z.array(attachmentTriggerSchema).min(1, "Add at least one trigger"),
})

export const listDeviceAttachmentsResponseSchema = z.object({
  attachments: z.array(deviceWorkflowAttachmentSchema),
})

export type AttachmentTriggerType = z.infer<typeof attachmentTriggerTypeSchema>
export type ConditionOperator = z.infer<typeof conditionOperatorSchema>
export type TelemetryCondition = z.infer<typeof telemetryConditionSchema>
export type ContextWindow = z.infer<typeof contextWindowSchema>
export type AttachmentTrigger = z.infer<typeof attachmentTriggerSchema>
export type DeviceWorkflowAttachment = z.infer<
  typeof deviceWorkflowAttachmentSchema
>
export type AttachWorkflowInput = z.infer<typeof attachWorkflowInputSchema>

// Context for an ad-hoc "Run now": what data the one-off run should process.
// Chosen per trigger type in the run-now dialog; not persisted on the attachment.
// (`sinceLastRun` is intentionally excluded — there is no cadence for a manual run.)
export type ManualWindow =
  | { mode: "range"; from: string; to: string }
  | { mode: "lastN"; n: number }

// A scheduled run grabs its media either as a hand-picked set of on-device
// sessions or as the most recent N — one or the other, not both.
export type ScheduleRunSelection =
  | { mode: "sessions"; sessionIds: string[] }
  | { mode: "lastNSessions"; n: number }

export type ManualRunContext =
  // Fires per session, so pick exactly one.
  | { triggerType: "session_completed"; sessionId: string }
  // Fires per chunk. `seq` omitted = the session's newest segment.
  | { triggerType: "segment_uploaded"; sessionId: string; seq?: number }
  | { triggerType: "schedule"; selection: ScheduleRunSelection }
  | { triggerType: "telemetry_condition"; window: ManualWindow }

// One-line, human-readable summary shown under a trigger badge in the table.
export function triggerSummary(trigger: AttachmentTrigger): string {
  switch (trigger.type) {
    case "session_completed":
    case "segment_uploaded":
      return `stream: ${trigger.streamKeys.join(", ")}`
    case "schedule":
      return `cron ${trigger.cron}`
    case "telemetry_condition":
      return trigger.conditions
        .map(
          (c) =>
            `${metricLabel(c.metric)} ${OPERATOR_SYMBOL[c.operator]} ${c.value}`,
        )
        .join(` ${trigger.combinator.toUpperCase()} `)
  }
}
