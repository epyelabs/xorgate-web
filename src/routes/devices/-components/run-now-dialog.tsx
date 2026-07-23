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
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RecordingsList, WindowPicker } from "@/components/recordings-list"
import { getDeviceRecordings, type Recording } from "@/lib/api"
import { runAttachmentNow } from "@/lib/device-workflows-api"
import {
  TRIGGER_TYPE_LABELS,
  triggerSummary,
  type DeviceWorkflowAttachment,
  type ManualRunContext,
  type ManualWindow,
} from "@/lib/device-workflow-schemas"
import { Segmented } from "./trigger-editors"

const DEFAULT_WINDOW: ManualWindow = { mode: "lastN", n: 100 }

// Ad-hoc "Run now": instead of firing immediately, gather the context the run
// should process, driven by the selected trigger. A recording trigger picks one
// recording (it fires per recording); a schedule picks its media EITHER as a
// hand-picked set OR the most recent N; a telemetry condition picks a window.
export function RunNowDialog({
  deviceId,
  attachment,
  open,
  onOpenChange,
  onRan,
}: {
  deviceId: string
  attachment: DeviceWorkflowAttachment | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRan: (attachment: DeviceWorkflowAttachment) => void
}) {
  // session_completed has no manual-run context (its runs are driven by the
  // cloud's session close; there is no "pick a session" backend path yet), so
  // it is not offered as a run-as choice here.
  const triggers = (attachment?.triggers ?? []).filter(
    (t) => t.type !== "session_completed",
  )
  const [triggerIdx, setTriggerIdx] = useState(0)
  const trigger = triggers[triggerIdx] ?? triggers[0] ?? null

  const [recordings, setRecordings] = useState<Recording[] | null>(null)
  const [recError, setRecError] = useState<string | null>(null)
  const [selectedRecIds, setSelectedRecIds] = useState<string[]>([])
  const [window, setWindow] = useState<ManualWindow>(DEFAULT_WINDOW)
  // Schedule media context: hand-pick recordings, or grab the most recent N.
  const [scheduleMode, setScheduleMode] = useState<"recordings" | "lastN">(
    "recordings",
  )
  const [scheduleN, setScheduleN] = useState(100)
  const [submitting, setSubmitting] = useState(false)

  // A recording trigger picks one recording; a schedule can hand-pick some.
  const recordingSingle = trigger?.type === "recording_saved"
  const needsRecordings =
    trigger?.type === "recording_saved" || trigger?.type === "schedule"

  // Reset the trigger selection when the dialog opens / targets another attachment.
  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setTriggerIdx(0)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, attachment?.id])

  // Reset the per-trigger picks whenever the active trigger changes.
  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelectedRecIds([])
    setWindow(DEFAULT_WINDOW)
    setScheduleMode("recordings")
    setScheduleN(100)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, attachment?.id, triggerIdx])

  // Load the device's recordings when the selected trigger needs them. We show
  // all of them (same as the Media tab) and only gate *selection* to completed
  // ones below — a real backend would additionally scope these to the trigger's
  // streams, but the mock attachment's stream keys don't map to real recordings.
  useEffect(() => {
    if (!open || !needsRecordings) return
    let cancelled = false
    /* eslint-disable react-hooks/set-state-in-effect */
    setRecordings(null)
    setRecError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    ;(async () => {
      try {
        const { recordings: all } = await getDeviceRecordings(deviceId)
        if (cancelled) return
        setRecordings(
          [...all].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
        )
      } catch (err) {
        if (!cancelled) setRecError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, needsRecordings, deviceId, triggerIdx])

  // Single-select for recording triggers (replace); multi-select otherwise.
  const toggleRec = (id: string) =>
    setSelectedRecIds((prev) => {
      if (recordingSingle) return prev[0] === id ? [] : [id]
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    })

  const windowValid =
    window.mode === "range"
      ? window.from !== "" && window.to !== ""
      : window.n > 0

  const canRun =
    !!trigger &&
    !submitting &&
    (trigger.type === "recording_saved"
      ? recordings !== null && selectedRecIds.length === 1
      : trigger.type === "schedule"
        ? scheduleMode === "recordings"
          ? selectedRecIds.length > 0
          : scheduleN > 0
        : windowValid)

  const handleRun = async () => {
    if (!attachment || !trigger) return
    const context: ManualRunContext =
      trigger.type === "recording_saved"
        ? { triggerType: "recording_saved", recordingId: selectedRecIds[0] ?? "" }
        : trigger.type === "schedule"
          ? {
              triggerType: "schedule",
              selection:
                scheduleMode === "recordings"
                  ? { mode: "recordings", recordingIds: selectedRecIds }
                  : { mode: "lastN", n: scheduleN },
            }
          : { triggerType: "telemetry_condition", window }
    setSubmitting(true)
    try {
      const { attachment: updated } = await runAttachmentNow(
        deviceId,
        attachment.id,
        context,
      )
      toast.success(`Run queued for "${attachment.templateName}"`)
      onRan(updated)
      onOpenChange(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Run {attachment ? `"${attachment.templateName}"` : "workflow"} now
          </DialogTitle>
          <DialogDescription>
            Choose the data this one-off run should process.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {triggers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              This workflow only runs when an on-device recording session
              completes — there is no manual-run context to choose. It will run
              automatically as sessions finish uploading.
            </p>
          ) : null}
          {triggers.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Run as trigger</span>
              <Select
                value={String(triggerIdx)}
                onValueChange={(v) => setTriggerIdx(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {triggers.map((t, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {TRIGGER_TYPE_LABELS[t.type]} · {triggerSummary(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {trigger?.type === "recording_saved" ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Recording</span>
              <RecordingsList
                recordings={recordings}
                recError={recError}
                selectedIds={selectedRecIds}
                single
                onToggle={toggleRec}
              />
              <p className="text-xs text-muted-foreground">
                This trigger fires per recording, so pick one. Only completed
                recordings can be selected.
              </p>
            </div>
          ) : trigger?.type === "schedule" ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">Recordings</span>
                <Segmented
                  value={scheduleMode}
                  onChange={setScheduleMode}
                  options={[
                    { value: "recordings", label: "Select recordings" },
                    { value: "lastN", label: "Last N" },
                  ]}
                />
              </div>
              {scheduleMode === "recordings" ? (
                <>
                  <RecordingsList
                    recordings={recordings}
                    recError={recError}
                    selectedIds={selectedRecIds}
                    single={false}
                    onToggle={toggleRec}
                  />
                  <p className="text-xs text-muted-foreground">
                    Pick the recordings this scheduled run should process. Only
                    completed recordings can be selected.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      className="w-24"
                      value={String(scheduleN)}
                      onChange={(e) =>
                        setScheduleN(
                          Math.max(1, Math.trunc(Number(e.target.value) || 0)),
                        )
                      }
                    />
                    <span className="text-xs text-muted-foreground">
                      most recent recordings
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The run processes the most recent recordings and their
                    telemetry.
                  </p>
                </>
              )}
            </div>
          ) : trigger?.type === "telemetry_condition" ? (
            <div className="flex flex-col gap-1.5">
              <WindowPicker value={window} onChange={setWindow} unit="readings" />
              <p className="text-xs text-muted-foreground">
                The run evaluates the condition over telemetry in this window.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              This workflow has no triggers to run.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleRun} disabled={!canRun}>
            {submitting ? "Starting…" : "Run workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
