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
import { SessionsList, WindowPicker } from "@/components/session-pickers"
import type { MediaSegment, MediaSession, TelemetrySession } from "@xorgate/sdk"
import { formatDuration } from "@/components/data-table"
import { formatDateTime } from "@/lib/format-time"
import { xg, xgMessage } from "@/lib/xorgate"
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
// The device's most recent N sessions; enough to cover recent drives without
// turning this dialog into a second Media tab.
const SESSION_PAGE = 50

// Ad-hoc "Run now": instead of firing immediately, gather the context the run
// should process, driven by the selected trigger. A session trigger picks one
// on-device session (it fires per session); a chunk trigger picks a session and
// then one of its segments; a schedule picks its media EITHER as a hand-picked
// set of sessions OR the most recent N; a telemetry condition picks a window.
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
  // Every trigger type is manually runnable since Phase W — session_completed
  // used to be filtered out here because the backend had no "pick a session"
  // path; it does now.
  const triggers = attachment?.triggers ?? []
  const [triggerIdx, setTriggerIdx] = useState(0)
  const trigger = triggers[triggerIdx] ?? triggers[0] ?? null

  const [sessions, setSessions] = useState<MediaSession[] | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([])
  const [window, setWindow] = useState<ManualWindow>(DEFAULT_WINDOW)
  // Schedule media context: hand-pick sessions, or grab the most recent N.
  const [scheduleMode, setScheduleMode] = useState<"sessions" | "lastN">(
    "sessions",
  )
  const [scheduleN, setScheduleN] = useState(5)
  // Chunk runs (segment_uploaded) additionally pick ONE segment of the session.
  const [segments, setSegments] = useState<MediaSegment[] | null>(null)
  const [segmentSeq, setSegmentSeq] = useState<number | null>(null)
  // Telemetry-session runs pick ONE telemetry session (its own table, its
  // own ids: not a media session).
  const [telemetrySessions, setTelemetrySessions] = useState<
    TelemetrySession[] | null
  >(null)
  const [telemetrySessionId, setTelemetrySessionId] = useState<string | null>(
    null,
  )
  const [submitting, setSubmitting] = useState(false)

  const sessionSingle =
    trigger?.type === "session_completed" || trigger?.type === "segment_uploaded"
  const needsSessions = sessionSingle || trigger?.type === "schedule"
  const needsSegment = trigger?.type === "segment_uploaded"
  const needsTelemetrySession = trigger?.type === "telemetry_session_completed"

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
    setSelectedSessionIds([])
    setWindow(DEFAULT_WINDOW)
    setScheduleMode("sessions")
    setScheduleN(5)
    setSegments(null)
    setSegmentSeq(null)
    setTelemetrySessionId(null)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, attachment?.id, triggerIdx])

  // The device's newest telemetry sessions (closed or open; an open one runs
  // over what has arrived so far, with insights null until it is built).
  useEffect(() => {
    if (!open || !needsTelemetrySession) return
    let cancelled = false
    /* eslint-disable react-hooks/set-state-in-effect */
    setTelemetrySessions(null)
    setSessionError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    ;(async () => {
      try {
        const { items: rows } = await xg().telemetry.sessions.list(deviceId, {
          limit: SESSION_PAGE,
          order: "desc",
          status: "any",
        })
        if (cancelled) return
        setTelemetrySessions(rows)
        setTelemetrySessionId(rows[0]?.id ?? null)
      } catch (err) {
        if (!cancelled) setSessionError(xgMessage(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, needsTelemetrySession, deviceId, triggerIdx])

  // Load the device's on-device sessions when the selected trigger needs them.
  // Newest first, server-side — all streams, not just the trigger's, so a
  // multi-camera attachment can be run against whichever camera you want.
  useEffect(() => {
    if (!open || !needsSessions) return
    let cancelled = false
    /* eslint-disable react-hooks/set-state-in-effect */
    setSessions(null)
    setSessionError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    ;(async () => {
      try {
        const { items: rows } = await xg().media.sessions.list(deviceId, {
          limit: SESSION_PAGE,
          sort: "startedAt",
          order: "desc",
        })
        if (!cancelled) setSessions(rows)
      } catch (err) {
        if (!cancelled) setSessionError(xgMessage(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, needsSessions, deviceId, triggerIdx])

  // A chunk run needs the chosen session's segments to pick one. Defaults to
  // the newest — the chunk that would have fired most recently.
  const chosenSessionId = selectedSessionIds[0] ?? null
  useEffect(() => {
    if (!open || !needsSegment || !chosenSessionId) return
    let cancelled = false
    /* eslint-disable react-hooks/set-state-in-effect */
    setSegments(null)
    setSegmentSeq(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    ;(async () => {
      try {
        const { segments: rows } = await xg().media.segments(
          deviceId,
          chosenSessionId,
        )
        if (cancelled) return
        // startTs, never seq — seq lies for reopened/evicted sessions.
        const ordered = [...rows].sort((a, b) => (a.startTs < b.startTs ? -1 : 1))
        setSegments(ordered)
        setSegmentSeq(ordered[ordered.length - 1]?.seq ?? null)
      } catch (err) {
        if (!cancelled) setSessionError(xgMessage(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, needsSegment, deviceId, chosenSessionId])

  // Single-select for the two media triggers (replace); multi-select for a schedule.
  const toggleSession = (id: string) =>
    setSelectedSessionIds((prev) => {
      if (sessionSingle) return prev[0] === id ? [] : [id]
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    })

  const windowValid =
    window.mode === "range"
      ? window.from !== "" && window.to !== ""
      : window.n > 0

  const canRun =
    !!trigger &&
    !submitting &&
    (trigger.type === "session_completed"
      ? sessions !== null && selectedSessionIds.length === 1
      : trigger.type === "segment_uploaded"
        ? sessions !== null && selectedSessionIds.length === 1 && segmentSeq !== null
        : trigger.type === "telemetry_session_completed"
          ? telemetrySessionId !== null
        : trigger.type === "schedule"
          ? scheduleMode === "sessions"
            ? selectedSessionIds.length > 0
            : scheduleN > 0
          : windowValid)

  const handleRun = async () => {
    if (!attachment || !trigger) return
    const context: ManualRunContext =
      trigger.type === "session_completed"
        ? { triggerType: "session_completed", sessionId: selectedSessionIds[0] ?? "" }
        : trigger.type === "segment_uploaded"
          ? {
              triggerType: "segment_uploaded",
              sessionId: selectedSessionIds[0] ?? "",
              ...(segmentSeq !== null ? { seq: segmentSeq } : {}),
            }
          : trigger.type === "telemetry_session_completed"
            ? {
                triggerType: "telemetry_session_completed",
                sessionId: telemetrySessionId ?? "",
              }
          : trigger.type === "schedule"
            ? {
                triggerType: "schedule",
                selection:
                  scheduleMode === "sessions"
                    ? { mode: "sessions", sessionIds: selectedSessionIds }
                    : { mode: "lastNSessions", n: scheduleN },
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

  const sessionPicker = (single: boolean, hint: string) => (
    <div className="flex flex-col gap-1.5">
      <SessionsList
        sessions={sessions}
        error={sessionError}
        selectedIds={selectedSessionIds}
        single={single}
        onToggle={toggleSession}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )

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

          {trigger?.type === "session_completed" ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Recording session</span>
              {sessionPicker(
                true,
                "This trigger fires per session, so pick one. The run decodes every segment it holds.",
              )}
            </div>
          ) : trigger?.type === "segment_uploaded" ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium">Recording session</span>
                {sessionPicker(
                  true,
                  "This trigger fires per ~60s chunk. Pick the session the chunk belongs to.",
                )}
              </div>
              {chosenSessionId ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium">Segment</span>
                  {segments === null ? (
                    <p className="text-xs text-muted-foreground">
                      Loading segments…
                    </p>
                  ) : segments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      This session has no stored segments.
                    </p>
                  ) : (
                    <Select
                      value={segmentSeq === null ? "" : String(segmentSeq)}
                      onValueChange={(v) => setSegmentSeq(Number(v))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pick a segment" />
                      </SelectTrigger>
                      <SelectContent>
                        {segments.map((seg) => (
                          <SelectItem key={seg.id} value={String(seg.seq)}>
                            #{seg.seq} ·{" "}
                            {new Date(seg.startTs).toLocaleTimeString()} ·{" "}
                            {Math.round(seg.durationMs / 1000)}s
                            {seg.finalized ? "" : " · partial"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Defaults to the newest chunk — the one that would have fired
                    most recently.
                  </p>
                </div>
              ) : null}
            </div>
          ) : trigger?.type === "telemetry_session_completed" ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Telemetry session</span>
              {sessionError ? (
                <p className="rounded-md border border-dashed border-destructive/50 px-3 py-4 text-center text-xs text-destructive">
                  Couldn&apos;t load telemetry sessions: {sessionError}
                </p>
              ) : telemetrySessions === null ? (
                <p className="text-xs text-muted-foreground">
                  Loading telemetry sessions…
                </p>
              ) : telemetrySessions.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  This device has no recorded telemetry sessions.
                </p>
              ) : (
                <Select
                  value={telemetrySessionId ?? ""}
                  onValueChange={(v) => setTelemetrySessionId(v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a session" />
                  </SelectTrigger>
                  <SelectContent>
                    {telemetrySessions.map((s) => {
                      const km = s.insights?.distance?.meters
                      return (
                        <SelectItem key={s.id} value={s.id}>
                          {formatDateTime(s.from)} ·{" "}
                          {formatDuration(Date.parse(s.to) - Date.parse(s.from))}
                          {typeof km === "number"
                            ? ` · ${(km / 1000).toFixed(1)} km`
                            : ""}
                          {s.status === "open" ? " · receiving" : ""}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              )}
              <p className="text-xs text-muted-foreground">
                This trigger fires per telemetry session, so pick one. The run's
                telemetry window is the session's recorded span and its insights
                ride along in the trigger context.
              </p>
            </div>
          ) : trigger?.type === "schedule" ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">Recording sessions</span>
                <Segmented
                  value={scheduleMode}
                  onChange={setScheduleMode}
                  options={[
                    { value: "sessions", label: "Select sessions" },
                    { value: "lastN", label: "Last N" },
                  ]}
                />
              </div>
              {scheduleMode === "sessions" ? (
                sessionPicker(
                  false,
                  "Pick the on-device sessions this scheduled run should process.",
                )
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
                      most recent sessions
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The run processes the most recent sessions and their
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
