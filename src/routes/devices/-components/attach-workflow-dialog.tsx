import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  attachWorkflowInputSchema,
  type AttachmentTrigger,
  type DeviceWorkflowAttachment,
} from "@/lib/device-workflow-schemas"
import { MOCK_STREAM_KEYS } from "@/lib/mock-device-workflows"
import { attachWorkflow } from "@/lib/device-workflows-api"
import { listWorkflowTemplates } from "@/lib/workflow-templates-api"
import {
  listWorkflowTemplatesResponseSchema,
  type WorkflowTemplateSummary,
} from "@/lib/workflow-schemas"

const TRIGGER_OPTIONS: readonly { value: AttachmentTrigger; label: string }[] = [
  { value: "manual", label: "Manual — run on demand" },
  { value: "recording_saved", label: "After a recording is saved" },
  { value: "telemetry_saved", label: "After telemetry is saved" },
  { value: "schedule", label: "On a schedule" },
]

const DEFAULT_CRON = "0 * * * *"

// Builds the human-readable trigger summary stored on the attachment.
function triggerDetailFor(
  trigger: AttachmentTrigger,
  streamKey: string,
  cron: string,
): string {
  switch (trigger) {
    case "manual":
      return "on demand"
    case "recording_saved":
      return `stream: ${streamKey}`
    case "telemetry_saved":
      return "on telemetry save"
    case "schedule":
      return cron.trim() || DEFAULT_CRON
  }
}

// Attach a published workflow template to this device: pick the template, choose
// whether to follow the published version or pin it, and configure a trigger.
// Mirrors the create-template-dialog controlled-state + safeParse + toast flow.
export function AttachWorkflowDialog({
  deviceId,
  open,
  onOpenChange,
  onAttached,
}: {
  deviceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onAttached: (attachment: DeviceWorkflowAttachment) => void
}) {
  const [templates, setTemplates] = useState<WorkflowTemplateSummary[] | null>(
    null,
  )
  const [templateId, setTemplateId] = useState("")
  const [versionChoice, setVersionChoice] = useState<"follow" | "pin">("follow")
  const [trigger, setTrigger] = useState<AttachmentTrigger>("telemetry_saved")
  const [streamKey, setStreamKey] = useState<string>(MOCK_STREAM_KEYS[0])
  const [cron, setCron] = useState(DEFAULT_CRON)
  const [submitting, setSubmitting] = useState(false)

  // Load the published templates available to attach when the dialog opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const raw = await listWorkflowTemplates()
        const parsed = listWorkflowTemplatesResponseSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error("Unexpected /workflow-templates response shape")
        }
        if (cancelled) return
        const published = parsed.data.templates.filter(
          (t) => t.status === "published",
        )
        setTemplates(published)
      } catch (err) {
        if (!cancelled) toast.error((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const reset = () => {
    setTemplateId("")
    setVersionChoice("follow")
    setTrigger("telemetry_saved")
    setStreamKey(MOCK_STREAM_KEYS[0])
    setCron(DEFAULT_CRON)
    setSubmitting(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const selected = templates?.find((t) => t.id === templateId) ?? null
  const publishedVersion = selected
    ? (selected.publishedVersion ?? selected.currentVersion)
    : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const pinnedVersion =
      versionChoice === "pin" && publishedVersion !== null
        ? publishedVersion
        : null
    const parsed = attachWorkflowInputSchema.safeParse({
      templateId,
      pinnedVersion,
      trigger,
      triggerDetail: triggerDetailFor(trigger, streamKey, cron),
    })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input")
      return
    }
    setSubmitting(true)
    try {
      const { attachment } = await attachWorkflow(deviceId, parsed.data)
      toast.success(`Attached "${attachment.templateName}"`)
      onAttached(attachment)
      reset()
      onOpenChange(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attach workflow</DialogTitle>
          <DialogDescription>
            Run a published workflow template against this device&apos;s data.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="attach-template">Workflow template</FieldLabel>
              {templates === null ? (
                <Skeleton className="h-7 w-full" />
              ) : templates.length === 0 ? (
                <FieldDescription>
                  No published templates yet. Publish a template first.
                </FieldDescription>
              ) : (
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger id="attach-template">
                    <SelectValue placeholder="Pick a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor="attach-version">Version</FieldLabel>
              <Select
                value={versionChoice}
                onValueChange={(v) => setVersionChoice(v as "follow" | "pin")}
              >
                <SelectTrigger id="attach-version">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="follow">
                    Follow published
                    {publishedVersion !== null ? ` (v${publishedVersion})` : ""}
                  </SelectItem>
                  <SelectItem value="pin" disabled={publishedVersion === null}>
                    Pin
                    {publishedVersion !== null ? ` to v${publishedVersion}` : ""}
                  </SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>
                Following picks up new published versions automatically.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="attach-trigger">Trigger</FieldLabel>
              <Select
                value={trigger}
                onValueChange={(v) => setTrigger(v as AttachmentTrigger)}
              >
                <SelectTrigger id="attach-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {trigger === "manual" ? (
                <FieldDescription>
                  Run on demand against a historical telemetry window or a saved
                  recording.
                </FieldDescription>
              ) : trigger === "telemetry_saved" ? (
                <FieldDescription>
                  Runs automatically whenever persisted telemetry lands.
                </FieldDescription>
              ) : null}
            </Field>

            {trigger === "recording_saved" ? (
              <Field>
                <FieldLabel htmlFor="attach-stream">Stream</FieldLabel>
                <Select value={streamKey} onValueChange={setStreamKey}>
                  <SelectTrigger id="attach-stream">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MOCK_STREAM_KEYS.map((key) => (
                      <SelectItem key={key} value={key}>
                        {key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Runs after each recording finishes on this stream.
                </FieldDescription>
              </Field>
            ) : null}

            {trigger === "schedule" ? (
              <Field>
                <FieldLabel htmlFor="attach-cron">Schedule (cron)</FieldLabel>
                <Input
                  id="attach-cron"
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder={DEFAULT_CRON}
                />
                <FieldDescription>
                  Standard cron expression. Default runs hourly.
                </FieldDescription>
              </Field>
            ) : null}
          </FieldGroup>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !templateId}>
              {submitting ? "Attaching…" : "Attach workflow"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
