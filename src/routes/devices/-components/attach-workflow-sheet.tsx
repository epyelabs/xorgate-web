import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  attachWorkflowInputSchema,
  type AttachWorkflowInput,
  type DeviceWorkflowAttachment,
} from "@/lib/device-workflow-schemas"
import { attachWorkflow } from "@/lib/device-workflows-api"
import { listWorkflowTemplates } from "@/lib/workflow-templates-api"
import {
  getDevice,
  getDeviceModel,
  getKvsChannels,
  type IoCapabilities,
} from "@/lib/api"
import { telemetryMetricOptions } from "@/lib/capability-metrics"
import {
  listWorkflowTemplatesResponseSchema,
  type WorkflowTemplateSummary,
} from "@/lib/workflow-schemas"
import { AttachConfigJson } from "./attach-config-json"
import { TemplatePicker } from "./template-picker"
import { TriggersEditor } from "./trigger-editors"

const EMPTY_DRAFT: AttachWorkflowInput = {
  templateId: "",
  pinnedVersion: null,
  triggers: [],
}

// Attach a published workflow template to this device: pick a template, choose
// whether to follow the published version or pin it, and configure one or more
// triggers. The draft IS the `AttachWorkflowInput` shape so the GUI form and the
// JSON editor are two views of a single source of truth.
export function AttachWorkflowSheet({
  deviceId,
  deviceName,
  attachedTemplateIds,
  open,
  onOpenChange,
  onAttached,
}: {
  deviceId: string
  deviceName?: string | null
  attachedTemplateIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onAttached: (attachment: DeviceWorkflowAttachment) => void
}) {
  const [templates, setTemplates] = useState<WorkflowTemplateSummary[] | null>(
    null,
  )
  // Real device capabilities: model io_capabilities + provisioned KVS channels,
  // used to populate the trigger editors and flag incompatible templates.
  const [deviceCaps, setDeviceCaps] = useState<IoCapabilities | null>(null)
  const [streamKeys, setStreamKeys] = useState<string[]>([])
  const [draft, setDraft] = useState<AttachWorkflowInput>(() => ({
    ...EMPTY_DRAFT,
  }))
  const [viewMode, setViewMode] = useState<"gui" | "json">("gui")
  // Bumped on each GUI→JSON switch so the JSON buffer re-seeds from the draft.
  const [jsonRevision, setJsonRevision] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  // Load the published templates available to attach when the sheet opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        // Page through the whole set so the picker isn't capped at one page.
        const all: WorkflowTemplateSummary[] = []
        let offset = 0
        let total = Infinity
        while (offset < total && all.length < 5000) {
          const raw = await listWorkflowTemplates({ limit: 500, offset })
          const parsed = listWorkflowTemplatesResponseSchema.safeParse(raw)
          if (!parsed.success) {
            throw new Error("Unexpected /workflow-templates response shape")
          }
          all.push(...parsed.data.templates)
          total = parsed.data.page?.total ?? parsed.data.templates.length
          if (parsed.data.templates.length === 0) break
          offset += 500
        }
        if (cancelled) return
        setTemplates(all.filter((t) => t.status === "published"))
      } catch (err) {
        if (!cancelled) toast.error((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  // Load this device's real capabilities (model + provisioned video channels).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const { device } = await getDevice(deviceId)
        if (cancelled) return
        const [{ device_model }, { channels }] = await Promise.all([
          getDeviceModel(device.deviceModelId),
          getKvsChannels(deviceId),
        ])
        if (cancelled) return
        setDeviceCaps(device_model.ioCapabilities)
        // recording_saved runs against recorded video streams (exclude audio).
        setStreamKeys(
          channels
            .map((c) => c.streamKey)
            .filter((k) => !k.startsWith("audio")),
        )
      } catch (err) {
        if (!cancelled) toast.error((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, deviceId])

  const metricOptions = telemetryMetricOptions(deviceCaps)

  const reset = () => {
    setDraft({ ...EMPTY_DRAFT })
    setViewMode("gui")
    setSubmitting(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const selected = templates?.find((t) => t.id === draft.templateId) ?? null
  const publishedVersion = selected
    ? (selected.publishedVersion ?? selected.currentVersion)
    : null

  const setMode = (next: "gui" | "json") => {
    if (next === "json") setJsonRevision((n) => n + 1)
    setViewMode(next)
  }

  const handleSelectTemplate = (templateId: string) =>
    // Reset the version pin: a pinned number is meaningless for a new template.
    setDraft((d) => ({ ...d, templateId, pinnedVersion: null }))

  const handleVersionChange = (choice: string) =>
    setDraft((d) => ({
      ...d,
      pinnedVersion:
        choice === "pin" && publishedVersion !== null ? publishedVersion : null,
    }))

  const canAttach = draft.templateId !== "" && draft.triggers.length > 0

  const handleSubmit = async () => {
    const parsed = attachWorkflowInputSchema.safeParse(draft)
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
    <Sheet open={open} onOpenChange={handleOpenChange}>
      {/* Widen past the sheet default (sm:max-w-sm) using the same data-side
          variant key so tailwind-merge collapses it and this wins. */}
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader className="gap-1 border-b border-border pb-3">
          <SheetTitle className="pr-8">
            Attach workflow to{" "}
            <span className="rounded bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">
              {deviceName || deviceId}
            </span>
          </SheetTitle>
          <div className="flex items-center justify-between gap-3">
            <SheetDescription>
              Run a published workflow template against this device&apos;s data.
            </SheetDescription>
            <div className="flex shrink-0 items-center gap-2">
              <Switch
                checked={viewMode === "json"}
                onCheckedChange={(checked) => setMode(checked ? "json" : "gui")}
                aria-label="Toggle JSON view"
              />
              <span
                className={cn(
                  "text-xs",
                  viewMode === "json"
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                JSON
              </span>
            </div>
          </div>
        </SheetHeader>

        <div
          className={cn(
            "min-h-0 flex-1 px-6 py-4",
            viewMode === "gui" ? "overflow-y-auto" : "flex flex-col",
          )}
        >
          {viewMode === "gui" ? (
            <div className="flex flex-col gap-5">
              <Field>
                <FieldLabel>Workflow template</FieldLabel>
                <TemplatePicker
                  templates={templates}
                  value={draft.templateId}
                  onSelect={handleSelectTemplate}
                  attachedTemplateIds={attachedTemplateIds}
                  deviceCapabilities={deviceCaps}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="attach-version">Version</FieldLabel>
                <Select
                  value={draft.pinnedVersion === null ? "follow" : "pin"}
                  onValueChange={handleVersionChange}
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
                <FieldLabel>Triggers</FieldLabel>
                <FieldDescription>
                  The workflow runs when any of these fire.
                </FieldDescription>
                <TriggersEditor
                  triggers={draft.triggers}
                  onChange={(triggers) => setDraft((d) => ({ ...d, triggers }))}
                  streamKeys={streamKeys}
                  metricOptions={metricOptions}
                />
              </Field>
            </div>
          ) : (
            <div className="min-h-0 flex-1">
              <AttachConfigJson
                value={draft}
                onChange={setDraft}
                revision={jsonRevision}
              />
            </div>
          )}
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t border-border">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !canAttach}
          >
            {submitting ? "Attaching…" : "Attach workflow"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
