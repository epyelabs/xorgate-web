import { MOCK_DEVICE_ATTACHMENTS } from "./mock-device-workflows"
import { MOCK_RUNS } from "./mock-workflow-runs"
import { listWorkflowTemplates } from "./workflow-templates-api"
import type {
  AttachWorkflowInput,
  DeviceWorkflowAttachment,
} from "./device-workflow-schemas"
import type {
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "./workflow-run-schemas"

// In-memory mock backend for the device "Workflows" tab. Every exported function
// mirrors the signature the real client in `lib/api.ts` will expose, so going
// live means replacing these bodies with `apiRequest(...)` calls against the
// device-scoped `/devices/:id/workflows` and `/devices/:id/workflow-runs`
// endpoints. Reads return deep clones so the UI can never mutate the store by
// reference.
//
// Device scoping note: the device detail layout fetches a REAL device whose id
// never matches the dummy attachment/run device ids, so these functions accept
// `deviceId` for signature parity but IGNORE it for filtering — every device
// shows the same fixtures. Wire the real device-scoped endpoint to partition for
// real.

const db: DeviceWorkflowAttachment[] = structuredClone(MOCK_DEVICE_ATTACHMENTS)

const delay = (ms = 220) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function clone<T>(value: T): T {
  return structuredClone(value)
}

function nowIso(): string {
  return new Date().toISOString()
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
}

// Same detail-only field strip as `workflow-instances-api.ts` so list rows
// validate against `listWorkflowRunsResponseSchema`.
function toSummary(run: WorkflowRunDetail): WorkflowRunSummary {
  const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    workspaceName: _p,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    triggeredBy: _t,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    definition: _d,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    steps: _s,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    events: _e,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    metrics: _m,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    error: _err,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    failedNodeId: _f,
    ...summary
  } = run
  return clone(summary)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function listDeviceAttachments(_deviceId: string): Promise<{
  attachments: DeviceWorkflowAttachment[]
}> {
  await delay()
  return { attachments: clone(db) }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function listDeviceRuns(_deviceId: string): Promise<{
  runs: WorkflowRunSummary[]
}> {
  await delay()
  const runs = [...MOCK_RUNS]
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .map(toSummary)
  return { runs }
}

export async function attachWorkflow(
  _deviceId: string,
  input: AttachWorkflowInput,
): Promise<{ attachment: DeviceWorkflowAttachment }> {
  await delay()
  const { templates } = await listWorkflowTemplates()
  const template = templates.find((t) => t.id === input.templateId)
  if (!template) throw new Error(`Workflow template not found: ${input.templateId}`)
  const published = template.publishedVersion ?? template.currentVersion
  const attachment: DeviceWorkflowAttachment = {
    id: uid("dwa"),
    deviceId: _deviceId,
    templateId: template.id,
    templateName: template.name,
    templateSlug: template.slug,
    pinnedVersion: input.pinnedVersion,
    runningVersion: input.pinnedVersion ?? published,
    enabled: true,
    trigger: input.trigger,
    triggerDetail: input.triggerDetail,
    lastRunAt: null,
    lastRunStatus: null,
    runCount: 0,
    createdAt: nowIso(),
  }
  db.unshift(attachment)
  return { attachment: clone(attachment) }
}

function find(attachmentId: string): DeviceWorkflowAttachment {
  const attachment = db.find((a) => a.id === attachmentId)
  if (!attachment) throw new Error(`Attachment not found: ${attachmentId}`)
  return attachment
}

export async function setAttachmentEnabled(
  _deviceId: string,
  attachmentId: string,
  enabled: boolean,
): Promise<{ attachment: DeviceWorkflowAttachment }> {
  await delay()
  const attachment = find(attachmentId)
  attachment.enabled = enabled
  return { attachment: clone(attachment) }
}

export async function detachWorkflow(
  _deviceId: string,
  attachmentId: string,
): Promise<void> {
  await delay()
  const idx = db.findIndex((a) => a.id === attachmentId)
  if (idx === -1) throw new Error(`Attachment not found: ${attachmentId}`)
  db.splice(idx, 1)
}

// Mock manual trigger: a real backend would enqueue an execution and return its
// id. `source` carries the historical telemetry window / media recording pointer
// for the "manual from history" path.
export async function runAttachmentNow(
  _deviceId: string,
  attachmentId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _source?: { kind: "telemetry" | "recording"; ref: string },
): Promise<{ attachment: DeviceWorkflowAttachment }> {
  await delay()
  const attachment = find(attachmentId)
  attachment.runCount += 1
  attachment.lastRunAt = nowIso()
  attachment.lastRunStatus = "running"
  return { attachment: clone(attachment) }
}
