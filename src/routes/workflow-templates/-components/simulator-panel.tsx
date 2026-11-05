import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  BanIcon,
  BookmarkCheckIcon,
  BookmarkIcon,
  CheckIcon,
  FlaskConicalIcon,
  Loader2Icon,
  PlayIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { isXorgateError } from "@xorgate/sdk"
import { xgMessage } from "@/lib/xorgate"
import {
  createSimulation,
  deleteSavedSimulation,
  saveSimulation,
} from "@/lib/workflow-templates-api"
import {
  cancelWorkflowInstance,
  getWorkflowInstance,
} from "@/lib/workflow-instances-api"
import {
  getWorkflowRunResponseSchema,
  type WorkflowRunDetail,
} from "@/lib/workflow-run-schemas"
import {
  useInvalidateSavedSimulations,
  useSavedSimulations,
} from "@/queries/workflows"
import { parsePublishIssues } from "@/lib/workflow-catalog-schemas"
import {
  parseBindingIssues,
  parseDispatchFailure,
  type CreateSimulationResponse,
  type SavedSimulation,
} from "@/lib/workflow-sim-schemas"
import type { WorkflowDefinition } from "@/lib/workflow-schemas"
import { useSimProgress } from "@/hooks/use-sim-progress"
import { useWebcamIngest } from "@/hooks/use-webcam-ingest"
import { useWorkflowCatalog } from "@/store/workflow-catalog"
import { useWorkflowEditor } from "@/store/workflow-editor"
import {
  BindingResolveError,
  resolveApiBindings,
  withSimulationCaptures,
} from "./simulator-bindings"
import { SourceInputRow } from "./source-input-row"
import { SourcePreviewDialog } from "./source-preview-dialog"
import { SourceDataPreviewDialog } from "./source-data-preview-dialog"
import { SimulatorOutput } from "./simulator-output"
import {
  formatSeconds,
  isTelemetryBinding,
  isVideoBinding,
  type SourceBinding,
} from "./simulator-types"
import {
  cancelConflict,
  defaultSaveName,
  isTerminalPhase,
  phaseForRunStatus,
  type SimPhase,
} from "./simulator-phase"
import { restoreBindings } from "./simulator-restore"

import {
  CANCELLED_BADGE_CLASS,
  SUCCEEDED_BADGE_CLASS,
  SaveRunDialog,
  SavedRunsList,
} from "./simulator-saved-runs"

export type { SimPhase } from "./simulator-phase"

const POLL_MS = 2500
// Once the IoT status topic says terminal, finalize (S3 event -> Lambda -> DB)
// usually lands within a couple seconds; poll faster for the artifacts row.
const POLL_FAST_MS = 1000
// M6: a second, independent re-read of the run row keyed on the run ID
// alone (not on the response object or the effect that owns the main poll),
// so a re-render that drops the main poll cannot leave the badge at Running.
// Faster once the IoT status says the engine is done.
const FALLBACK_POLL_MS = 10_000
const FALLBACK_POLL_TERMINAL_MS = 1500
// No successful read of the run row for this long while running = the poll
// stalled (a stopped timer, an expired session, a dropped network); the panel
// says so and offers a manual check instead of spinning silently.
const POLL_STALL_MS = 60_000

// The run's state beside the "Output" label: Running while in flight, then
// "Succeeded in 2.8s" (green), "Failed after 2.8s" (red) or "Cancelled after
// 2.8s" (amber); nothing before the first run.
function RunStatusBadge({
  phase,
  durationMs,
}: {
  phase: SimPhase
  durationMs: number | null
}) {
  const took = durationMs !== null ? formatSeconds(durationMs / 1000) : null
  if (phase === "succeeded") {
    return (
      <Badge
        variant="secondary"
        className={`gap-1 ${SUCCEEDED_BADGE_CLASS}`}
        data-testid="run-status-badge"
      >
        <CheckIcon />
        Succeeded{took ? ` in ${took}` : ""}
      </Badge>
    )
  }
  if (phase === "failed") {
    return (
      <Badge
        variant="destructive"
        className="gap-1"
        data-testid="run-status-badge"
      >
        <XIcon />
        Failed{took ? ` after ${took}` : ""}
      </Badge>
    )
  }
  if (phase === "cancelled") {
    return (
      <Badge
        variant="secondary"
        className={`gap-1 ${CANCELLED_BADGE_CLASS}`}
        data-testid="run-status-badge"
      >
        <BanIcon />
        Cancelled{took ? ` after ${took}` : ""}
      </Badge>
    )
  }
  if (phase === "running" || phase === "preparing") {
    return (
      <Badge
        variant="secondary"
        className="gap-1"
        data-testid="run-status-badge"
      >
        <Loader2Icon className="animate-spin" />
        Running
      </Badge>
    )
  }
  return null
}

// Revoke any in-browser object URL a binding created, so uploaded-video previews
// don't leak when unbound / replaced / on unmount.
function revoke(binding: SourceBinding | undefined) {
  if (binding && binding.kind === "video-file") URL.revokeObjectURL(binding.url)
}

// The "Workflow Testing" pane. Reads the live graph's source nodes, lets the
// user bind a concrete test input to each, and runs the CURRENT editor draft
// as a real simulation run of the v2 engine (backend workflow-simulations.ts),
// with live step/event/preview progress over IoT WSS and results (the run
// header, the engine's output video, trace, events, every artifact) once the
// run lands.
export function SimulatorPanel({
  templateId,
  onClose,
}: {
  templateId: string
  onClose: () => void
}) {
  const nodes = useWorkflowEditor((s) => s.nodes)
  const byType = useWorkflowCatalog((s) => s.byType)

  // Source rows, with a per-type index suffix when a type appears more than once
  // (e.g. two "Video" nodes -> "Video 1" / "Video 2"). Connector sources
  // (Google Roads) take graph inputs rather than test bindings, so only true
  // sources (no input ports) get a row.
  const sources = useMemo(() => {
    const src = nodes.filter((n) => {
      const entry = byType[n.data.catalogType]
      return entry?.group === "source" && entry.inputs.length === 0
    })
    const totals = new Map<string, number>()
    for (const n of src)
      totals.set(n.data.catalogType, (totals.get(n.data.catalogType) ?? 0) + 1)
    const seen = new Map<string, number>()
    return src.map((n) => {
      const ct = n.data.catalogType
      const base = n.data.label || byType[ct]?.label || ct
      let label = base
      if ((totals.get(ct) ?? 0) > 1) {
        const idx = (seen.get(ct) ?? 0) + 1
        seen.set(ct, idx)
        label = `${base} ${idx}`
      }
      return { id: n.id, catalogType: ct, label }
    })
  }, [nodes, byType])

  const [bindings, setBindings] = useState<Record<string, SourceBinding>>({})
  const [preview, setPreview] = useState<SourceBinding | null>(null)

  const [phase, setPhase] = useState<SimPhase>("idle")
  const [prepMessage, setPrepMessage] = useState<string | null>(null)
  // Per-source-row problems (binding resolution or SIMULATION_BINDING_INVALID),
  // plus row-less issues rendered above the rows.
  const [rowIssues, setRowIssues] = useState<Record<string, string>>({})
  const [generalIssues, setGeneralIssues] = useState<string[]>([])

  const [activeRun, setActiveRun] = useState<CreateSimulationResponse | null>(
    null
  )
  const [ranDefinition, setRanDefinition] = useState<WorkflowDefinition | null>(
    null
  )
  const [runDetail, setRunDetail] = useState<WorkflowRunDetail | null>(null)
  // A cancel request in flight (the Cancel button disables; Run stays off
  // until it answers so a late answer can never land on a newer run).
  const [cancelling, setCancelling] = useState(false)

  // Saved runs (per template + current user).
  const savedQuery = useSavedSimulations(templateId)
  const refreshSaved = useInvalidateSavedSimulations(templateId)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [loadingSavedId, setLoadingSavedId] = useState<string | null>(null)
  // The panel's two tabs: the simulator itself, and the saved-runs list.
  const [panelTab, setPanelTab] = useState<"test" | "saved">("test")

  // Both sections open initially; a started run collapses Sources so the
  // Output takes over (the user can re-open Sources anytime).
  const [openSections, setOpenSections] = useState<string[]>([
    "sources",
    "output",
  ])

  // Poll health (M6): when the run row last answered, how many reads failed
  // in a row, and whether the panel should say it has lost touch.
  const lastPollOkRef = useRef<number>(Date.now())
  const pollFailuresRef = useRef(0)
  const [pollStalled, setPollStalled] = useState(false)
  const [pollFailures, setPollFailures] = useState(0)
  // Bumped when the tab becomes visible again: the IoT hook re-subscribes on
  // a fresh presigned URL for the same run without dropping what it has.
  const [reconnectKey, setReconnectKey] = useState(0)

  // Live progress over IoT WSS; subscribed while a run is in flight.
  const progress = useSimProgress(
    phase === "running" ? (activeRun?.progress.topicPrefix ?? null) : null,
    reconnectKey
  )

  // Webcam capture publisher (M5): while a run with a webcam binding is live,
  // sample the camera and publish frames to the run's ingest topic. Stopping
  // (or unmount) publishes the end message so the engine drains cleanly.
  const webcamEntry = useMemo(() => {
    const entry = Object.entries(bindings).find(
      ([, b]) => b.kind === "video-webcam"
    )
    return entry
      ? {
          nodeId: entry[0],
          deviceId: (entry[1] as { deviceId?: string }).deviceId,
        }
      : null
  }, [bindings])
  const webcamIngest = useWebcamIngest({
    active: phase === "running" && webcamEntry !== null,
    topicPrefix: activeRun?.progress.topicPrefix ?? null,
    nodeId: webcamEntry?.nodeId ?? null,
    cameraDeviceId: webcamEntry?.deviceId,
  })

  // Keep a live ref so the unmount cleanup revokes whatever is bound at the time.
  const bindingsRef = useRef(bindings)
  useEffect(() => {
    bindingsRef.current = bindings
  }, [bindings])
  useEffect(() => {
    return () => {
      for (const b of Object.values(bindingsRef.current)) revoke(b)
    }
  }, [])

  // Drop (and revoke) bindings whose source node was deleted from the graph.
  useEffect(() => {
    const ids = new Set(sources.map((s) => s.id))
    /* eslint-disable react-hooks/set-state-in-effect */
    setBindings((prev) => {
      const stale = Object.keys(prev).filter((id) => !ids.has(id))
      if (stale.length === 0) return prev
      const next = { ...prev }
      for (const id of stale) {
        revoke(next[id])
        delete next[id]
      }
      return next
    })
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [sources])

  const bind = (nodeId: string, binding: SourceBinding) =>
    setBindings((prev) => {
      revoke(prev[nodeId])
      return { ...prev, [nodeId]: binding }
    })

  const unbind = (nodeId: string) =>
    setBindings((prev) => {
      revoke(prev[nodeId])
      const next = { ...prev }
      delete next[nodeId]
      return next
    })

  const boundCount = sources.filter((s) => bindings[s.id]).length
  const running = phase === "preparing" || phase === "running"

  // --- Terminal handling -------------------------------------------------------

  // The run row is the terminal source of truth; the Output renders it
  // (header, the engine's output video, trace, events, artifacts).
  const finishRun = useCallback((detail: WorkflowRunDetail) => {
    setRunDetail(detail)
    // Only ever called with a terminal row (succeeded | failed | cancelled).
    setPhase(phaseForRunStatus(detail.status))
  }, [])

  // One read of the run row: finishes the run when the row is terminal, and
  // keeps the poll-health counters either way. Shared by the main poll, the
  // fallback timer, the visibility handler and the manual "Check now".
  const activeRunId = activeRun?.run.id ?? null
  const readRunRow = useCallback(async (): Promise<boolean> => {
    if (!activeRunId) return false
    try {
      const raw = await getWorkflowInstance(activeRunId)
      const parsed = getWorkflowRunResponseSchema.safeParse(raw)
      if (!parsed.success) throw new Error("unexpected run detail shape")
      lastPollOkRef.current = Date.now()
      pollFailuresRef.current = 0
      setPollFailures(0)
      setPollStalled(false)
      if (parsed.data.run.status !== "running") {
        finishRun(parsed.data.run)
        return true
      }
      return false
    } catch {
      // Transient fetch/auth hiccups: keep polling, but count them so a
      // run that has gone quiet for a minute is reported instead of spun on.
      pollFailuresRef.current += 1
      setPollFailures(pollFailuresRef.current)
      return false
    }
  }, [activeRunId, finishRun])

  // Poll the run row while in flight. The IoT status topic can beat finalize
  // (or be missed entirely on a fast Lambda run), so the DB row decides.
  const iotSaysTerminal =
    progress.status !== null && progress.status.status !== "running"
  useEffect(() => {
    if (phase !== "running" || !activeRunId) return
    let cancelled = false
    const tick = () => {
      if (!cancelled) void readRunRow()
    }
    const interval = setInterval(tick, iotSaysTerminal ? POLL_FAST_MS : POLL_MS)
    tick()
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [phase, activeRunId, iotSaysTerminal, readRunRow])

  // Fallback re-read (M6): keyed on the run ID string only, so it survives
  // whatever re-render might drop the main poll; quick once the IoT status
  // topic says the engine finished and the row is about to land.
  useEffect(() => {
    if (phase !== "running" || !activeRunId) return
    const interval = setInterval(
      () => void readRunRow(),
      iotSaysTerminal ? FALLBACK_POLL_TERMINAL_MS : FALLBACK_POLL_MS
    )
    return () => clearInterval(interval)
  }, [phase, activeRunId, iotSaysTerminal, readRunRow])

  // Stall detection (M6): no successful read for POLL_STALL_MS while running.
  useEffect(() => {
    if (phase !== "running") return
    const interval = setInterval(() => {
      setPollStalled(Date.now() - lastPollOkRef.current > POLL_STALL_MS)
    }, 5000)
    return () => clearInterval(interval)
  }, [phase])

  // Back from a hidden tab (M6): read the row now and re-subscribe the live
  // topics; browsers throttle timers and drop sockets while a tab is hidden.
  useEffect(() => {
    if (phase !== "running") return
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return
      void readRunRow()
      setReconnectKey((k) => k + 1)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [phase, readRunRow])

  // --- Cancel -------------------------------------------------------------------

  // Stops the in-flight run. The backend flips the row to cancelled atomically
  // and answers with it; the IoT subscription and webcam ingest stop by
  // themselves once the phase leaves "running".
  const cancelRun = async () => {
    if (!activeRunId || cancelling) return
    setCancelling(true)
    try {
      const { run } = await cancelWorkflowInstance(activeRunId)
      finishRun(run)
    } catch (err) {
      // 409 RUN_NOT_RUNNING: it landed (or was cancelled) first; adopt the
      // row the backend sent, else read it.
      const conflict = cancelConflict(err)
      if (conflict) {
        if (conflict.run && conflict.run.status !== "running") {
          finishRun(conflict.run)
        } else {
          await readRunRow()
        }
        return
      }
      toast.error(`Could not cancel the run: ${xgMessage(err)}`)
    } finally {
      setCancelling(false)
    }
  }

  // --- Saved runs -----------------------------------------------------------------

  const savedList = savedQuery.data
  const savedForShownRun = runDetail
    ? (savedList?.find((s) => s.runId === runDetail.id) ?? null)
    : null

  const saveRun = async (name: string): Promise<boolean> => {
    if (!runDetail) return false
    try {
      await saveSimulation(templateId, runDetail.id, name)
      toast.success("Run saved")
      await refreshSaved()
      return true
    } catch (err) {
      toast.error(`Could not save the run: ${xgMessage(err)}`)
      return false
    }
  }

  const deleteSaved = async (saved: SavedSimulation) => {
    try {
      await deleteSavedSimulation(templateId, saved.id)
      toast.success("Saved run deleted")
    } catch (err) {
      toast.error(`Could not delete the saved run: ${xgMessage(err)}`)
    } finally {
      // A 404 means it is already gone; refresh either way.
      await refreshSaved()
    }
  }

  // Reopens a saved run's results on the Test tab: the run row alone drives
  // the Output (no live progress, no active run, so no polling or IoT). The
  // source bindings come back from the save's snapshot where that needs no
  // fetch (see simulator-restore.ts); the rest keep whatever compatible
  // binding is there now, and only the ones left unbound are reported.
  const loadSaved = async (saved: SavedSimulation) => {
    if (running || loadingSavedId) return
    setLoadingSavedId(saved.id)
    try {
      const parsed = getWorkflowRunResponseSchema.safeParse(
        await getWorkflowInstance(saved.runId)
      )
      if (!parsed.success) throw new Error("unexpected run detail shape")
      const run = parsed.data.run
      if (run.status === "running") {
        toast.info("That run is still running")
        return
      }
      const restored = restoreBindings(
        saved.bindings,
        sources,
        run.deviceId && run.deviceName
          ? { [run.deviceId]: run.deviceName }
          : {},
        bindings
      )
      setBindings((prev) => {
        const next = { ...prev }
        for (const [nodeId, b] of Object.entries(restored.bindings)) {
          revoke(next[nodeId])
          next[nodeId] = b
        }
        return next
      })
      setRowIssues({})
      setGeneralIssues([])
      setActiveRun(null)
      setPrepMessage(null)
      setPollStalled(false)
      setRunDetail(run)
      setRanDefinition(run.definition)
      setPhase(phaseForRunStatus(run.status))
      setPanelTab("test")
      setOpenSections((open) =>
        open.includes("output") ? open : ["output", ...open]
      )
      if (restored.unrestored.length > 0) {
        const labels = restored.unrestored.map(
          (u) => sources.find((src) => src.id === u.nodeId)?.label ?? u.nodeId
        )
        toast.info(
          `Bind ${labels.join(", ")} again to re-run: ${restored.unrestored.length === 1 ? "its input" : "those inputs"} could not be restored from the saved run.`
        )
      }
    } catch (err) {
      toast.error(`Could not load the run: ${xgMessage(err)}`)
    } finally {
      setLoadingSavedId(null)
    }
  }

  // --- Run ----------------------------------------------------------------------

  const runWorkflow = async () => {
    setPhase("preparing")
    setPrepMessage(null)
    setRowIssues({})
    setGeneralIssues([])
    setRunDetail(null)
    setActiveRun(null)
    lastPollOkRef.current = Date.now()
    pollFailuresRef.current = 0
    setPollFailures(0)
    setPollStalled(false)
    useWorkflowEditor.getState().setPublishIssues([])
    try {
      // Uploads + window resolution first (per-row failures land on the rows).
      const resolved = await resolveApiBindings(
        templateId,
        bindings,
        setPrepMessage
      )
      if (Object.keys(resolved.uploadedKeys).length > 0) {
        // Cache upload keys so tweak-and-rerun skips the re-upload.
        setBindings((prev) => {
          const next = { ...prev }
          for (const [nodeId, uploadKey] of Object.entries(
            resolved.uploadedKeys
          )) {
            const b = next[nodeId]
            if (b && (b.kind === "video-file" || b.kind === "csv-file")) {
              next[nodeId] = { ...b, uploadKey }
            }
          }
          return next
        })
      }

      setPrepMessage("Starting simulation…")
      const definition = withSimulationCaptures(
        useWorkflowEditor.getState().toDefinition()
      )
      const res = await createSimulation(templateId, definition, resolved.api)
      setRanDefinition(definition)
      setActiveRun(res)
      setPhase("running")
      setOpenSections(["output"])
    } catch (err) {
      setPhase("idle")
      if (err instanceof BindingResolveError) {
        setRowIssues({ [err.nodeId]: err.message })
        return
      }
      if (isXorgateError(err)) {
        // XorgateError splits the wire envelope across fields; rebuild it for
        // the body-text parsers.
        const body = JSON.stringify({
          error: {
            code: err.code,
            message: xgMessage(err),
            details: err.details,
          },
        })
        // 400 WORKFLOW_VALIDATION_FAILED: same shape as publish; light the
        // canvas + banner through the editor store.
        const publishIssues = parsePublishIssues(body)
        if (publishIssues && publishIssues.length > 0) {
          useWorkflowEditor.getState().setPublishIssues(publishIssues)
          toast.error(
            `Simulation blocked: ${publishIssues.length} validation ${publishIssues.length === 1 ? "issue" : "issues"}`
          )
          return
        }
        // 400 SIMULATION_BINDING_INVALID: render per source row by nodeId.
        const bindingIssues = parseBindingIssues(body)
        if (bindingIssues && bindingIssues.length > 0) {
          const rows: Record<string, string> = {}
          const general: string[] = []
          for (const issue of bindingIssues) {
            if (issue.nodeId) rows[issue.nodeId] = issue.message
            else general.push(issue.message)
          }
          setRowIssues(rows)
          setGeneralIssues(general)
          setOpenSections((open) =>
            open.includes("sources") ? open : ["sources", ...open]
          )
          return
        }
        // 502 SIMULATION_DISPATCH_FAILED: the run row is already failed.
        const dispatch = parseDispatchFailure(body)
        if (dispatch) {
          toast.error(`Simulation failed to start: ${dispatch.message}`)
          return
        }
      }
      toast.error(xgMessage(err))
    } finally {
      setPrepMessage(null)
    }
  }

  return (
    <aside className="flex min-h-0 w-[28rem] shrink-0 flex-col overflow-hidden border-l border-border bg-card/40">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-1.5">
        <span className="text-xs font-medium text-foreground">
          Workflow Testing
        </span>
        <div className="flex items-center gap-2">
          {sources.length > 0 ? (
            <span className="text-[11px] text-muted-foreground">
              {boundCount} of {sources.length} bound
            </span>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            title="Close"
            aria-label="Close workflow testing"
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </div>

      {/* Two tabs: Test (the simulator) and Saved (this user's saved runs).
          Test stays mounted while hidden so its Output (video, open tab)
          survives a look at the saved list. */}
      <Tabs
        value={panelTab}
        onValueChange={(v) => setPanelTab(v as "test" | "saved")}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="flex shrink-0 items-center border-b border-border px-4 py-1.5">
          <TabsList className="h-auto rounded-md border border-border bg-transparent p-0.5 group-data-horizontal/tabs:h-auto">
            <TabsTrigger
              value="test"
              className="h-6 px-2 data-[state=active]:bg-muted data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-muted"
              data-testid="sim-tab-test"
            >
              <FlaskConicalIcon className="size-3.5" />
              Test
            </TabsTrigger>
            <TabsTrigger
              value="saved"
              className="h-6 px-2 data-[state=active]:bg-muted data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-muted"
              data-testid="sim-tab-saved"
            >
              <BookmarkIcon className="size-3.5" />
              Saved
              {savedList && savedList.length > 0 ? (
                <Badge
                  variant="secondary"
                  className="ml-0.5"
                  data-testid="sim-saved-count"
                >
                  {savedList.length}
                </Badge>
              ) : null}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="test"
          forceMount
          className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          {/* Sources + Output as an accordion so a running/finished run can hand
          the space over to the Output. The whole body scrolls. */}
          <Accordion
            type="multiple"
            value={openSections}
            onValueChange={setOpenSections}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4"
          >
            <AccordionItem value="sources">
              <AccordionTrigger className="py-3">
                Sources (Inputs)
              </AccordionTrigger>
              <AccordionContent className="pb-3">
                <div className="flex flex-col gap-2.5">
                  {generalIssues.map((msg, i) => (
                    <p
                      key={i}
                      className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive"
                    >
                      {msg}
                    </p>
                  ))}
                  {sources.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                      Add a source node (Video, Telemetry) to the graph to test
                      this workflow.
                    </p>
                  ) : (
                    sources.map((s) => (
                      <SourceInputRow
                        key={s.id}
                        label={s.label}
                        catalogType={s.catalogType}
                        binding={bindings[s.id]}
                        issue={rowIssues[s.id]}
                        onBind={(b) => bind(s.id, b)}
                        onUnbind={() => unbind(s.id)}
                        onPreview={setPreview}
                      />
                    ))
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="output">
              <AccordionTrigger className="py-3">
                <span className="flex items-center gap-2">
                  Output
                  <RunStatusBadge
                    phase={phase}
                    durationMs={runDetail?.durationMs ?? null}
                  />
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-3">
                <div className="min-h-64 rounded-md border border-border bg-muted/30 p-3">
                  {/* Keyed on the landed run so a Load of another saved run starts
                  its tabs fresh. A loaded run has no activeRun: the row
                  itself supplies startedAt (engineTarget only matters for
                  the live cold-start line). */}
                  <SimulatorOutput
                    key={runDetail?.id ?? "live"}
                    phase={phase}
                    prepMessage={prepMessage}
                    engineTarget={activeRun?.run.engineTarget ?? null}
                    startedAt={
                      activeRun?.run.startedAt ?? runDetail?.startedAt ?? null
                    }
                    progress={progress}
                    run={runDetail}
                    ranDefinition={ranDefinition}
                    webcam={webcamEntry ? webcamIngest : null}
                  />
                  {phase === "running" && pollStalled ? (
                    <p
                      className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-900 dark:text-amber-200"
                      data-testid="run-poll-stalled"
                    >
                      Still running? This page has had no answer about the run
                      for over a minute
                      {pollFailures > 0
                        ? ` (${pollFailures} failed ${pollFailures === 1 ? "check" : "checks"})`
                        : ""}
                      .{" "}
                      <button
                        type="button"
                        className="underline underline-offset-2"
                        onClick={() => void readRunRow()}
                        data-testid="run-poll-check-now"
                      >
                        Check now
                      </button>
                      , or reload: the run keeps going on the platform and is
                      listed under Workflow Instances.
                    </p>
                  ) : null}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="flex shrink-0 gap-2 border-t border-border p-3">
            <Button
              type="button"
              className="min-w-0 flex-1 gap-1.5"
              onClick={runWorkflow}
              disabled={running || cancelling}
            >
              {running ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <PlayIcon className="size-3.5" />
              )}
              <span className="truncate">
                {phase === "preparing"
                  ? (prepMessage ?? "Starting…")
                  : phase === "running"
                    ? "Running…"
                    : "Run Workflow"}
              </span>
            </Button>
            {phase === "running" && activeRun ? (
              <Button
                type="button"
                variant="destructive"
                className="gap-1.5"
                onClick={() => void cancelRun()}
                disabled={cancelling}
                data-testid="sim-cancel"
              >
                {cancelling ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <SquareIcon className="size-3.5" />
                )}
                {cancelling ? "Cancelling…" : "Cancel"}
              </Button>
            ) : null}
            {isTerminalPhase(phase) && runDetail ? (
              <Button
                type="button"
                variant="outline"
                className="gap-1.5"
                onClick={() => setSaveDialogOpen(true)}
                disabled={savedForShownRun !== null || savedQuery.isPending}
                title={
                  savedForShownRun
                    ? `Saved as "${savedForShownRun.name}"`
                    : "Save this run to reopen it later"
                }
                data-testid="sim-save"
                data-saved={savedForShownRun ? "true" : "false"}
              >
                {savedForShownRun ? (
                  <BookmarkCheckIcon className="size-3.5" />
                ) : (
                  <BookmarkIcon className="size-3.5" />
                )}
                {savedForShownRun ? "Saved" : "Save run"}
              </Button>
            ) : null}
          </div>
        </TabsContent>

        <TabsContent
          value="saved"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3"
        >
          <SavedRunsList
            saved={savedList}
            isPending={savedQuery.isPending}
            error={savedQuery.error ? xgMessage(savedQuery.error) : null}
            shownRunId={runDetail?.id ?? null}
            loadingId={loadingSavedId}
            loadDisabled={running}
            onLoad={(s) => void loadSaved(s)}
            onDelete={deleteSaved}
          />
        </TabsContent>
      </Tabs>

      {saveDialogOpen && runDetail ? (
        <SaveRunDialog
          defaultName={defaultSaveName(new Date(runDetail.startedAt))}
          onOpenChange={setSaveDialogOpen}
          onSave={saveRun}
        />
      ) : null}

      <SourcePreviewDialog
        binding={preview && isVideoBinding(preview) ? preview : null}
        open={preview !== null && isVideoBinding(preview)}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
      />
      <SourceDataPreviewDialog
        binding={preview && isTelemetryBinding(preview) ? preview : null}
        open={preview !== null && isTelemetryBinding(preview)}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
      />
    </aside>
  )
}
