import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Loader2Icon, PlayIcon, XIcon } from "lucide-react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { isXorgateError } from "@xorgate/sdk"
import { xgMessage } from "@/lib/xorgate"
import { createSimulation } from "@/lib/workflow-templates-api"
import { getWorkflowInstance } from "@/lib/workflow-instances-api"
import {
  getWorkflowRunResponseSchema,
  type WorkflowRunDetail,
} from "@/lib/workflow-run-schemas"
import { parsePublishIssues } from "@/lib/workflow-catalog-schemas"
import {
  parseBindingIssues,
  parseDispatchFailure,
  type CreateSimulationResponse,
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
  isTelemetryBinding,
  isVideoBinding,
  type SourceBinding,
} from "./simulator-types"

// idle -> preparing (uploads/window resolution + POST) -> running (live
// progress over IoT + run-row polling) -> succeeded | failed. The run row is
// the terminal source of truth; IoT topics are the live view only.
export type SimPhase = "idle" | "preparing" | "running" | "succeeded" | "failed"

const POLL_MS = 2500
// Once the IoT status topic says terminal, finalize (S3 event -> Lambda -> DB)
// usually lands within a couple seconds; poll faster for the artifacts row.
const POLL_FAST_MS = 1000

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

  const [activeRun, setActiveRun] = useState<CreateSimulationResponse | null>(null)
  const [ranDefinition, setRanDefinition] = useState<WorkflowDefinition | null>(null)
  const [runDetail, setRunDetail] = useState<WorkflowRunDetail | null>(null)

  // Both sections open initially; a started run collapses Sources so the
  // Output takes over (the user can re-open Sources anytime).
  const [openSections, setOpenSections] = useState<string[]>([
    "sources",
    "output",
  ])

  // Live progress over IoT WSS; subscribed while a run is in flight.
  const progress = useSimProgress(
    phase === "running" ? (activeRun?.progress.topicPrefix ?? null) : null,
  )

  // Webcam capture publisher (M5): while a run with a webcam binding is live,
  // sample the camera and publish frames to the run's ingest topic. Stopping
  // (or unmount) publishes the end message so the engine drains cleanly.
  const webcamEntry = useMemo(() => {
    const entry = Object.entries(bindings).find(
      ([, b]) => b.kind === "video-webcam",
    )
    return entry
      ? { nodeId: entry[0], deviceId: (entry[1] as { deviceId?: string }).deviceId }
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
    setPhase(detail.status === "succeeded" ? "succeeded" : "failed")
  }, [])

  // Poll the run row while in flight. The IoT status topic can beat finalize
  // (or be missed entirely on a fast Lambda run), so the DB row decides.
  const iotSaysTerminal =
    progress.status !== null && progress.status.status !== "running"
  useEffect(() => {
    if (phase !== "running" || !activeRun) return
    let cancelled = false
    const runId = activeRun.run.id
    const tick = async () => {
      try {
        const raw = await getWorkflowInstance(runId)
        const parsed = getWorkflowRunResponseSchema.safeParse(raw)
        if (!parsed.success || cancelled) return
        if (parsed.data.run.status !== "running") finishRun(parsed.data.run)
      } catch {
        // Transient fetch/auth hiccups: keep polling.
      }
    }
    const interval = setInterval(tick, iotSaysTerminal ? POLL_FAST_MS : POLL_MS)
    void tick()
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [phase, activeRun, iotSaysTerminal, finishRun])

  // --- Run ----------------------------------------------------------------------

  const runWorkflow = async () => {
    setPhase("preparing")
    setPrepMessage(null)
    setRowIssues({})
    setGeneralIssues([])
    setRunDetail(null)
    setActiveRun(null)
    useWorkflowEditor.getState().setPublishIssues([])
    try {
      // Uploads + window resolution first (per-row failures land on the rows).
      const resolved = await resolveApiBindings(templateId, bindings, setPrepMessage)
      if (Object.keys(resolved.uploadedKeys).length > 0) {
        // Cache upload keys so tweak-and-rerun skips the re-upload.
        setBindings((prev) => {
          const next = { ...prev }
          for (const [nodeId, uploadKey] of Object.entries(resolved.uploadedKeys)) {
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
        useWorkflowEditor.getState().toDefinition(),
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
          error: { code: err.code, message: xgMessage(err), details: err.details },
        })
        // 400 WORKFLOW_VALIDATION_FAILED: same shape as publish; light the
        // canvas + banner through the editor store.
        const publishIssues = parsePublishIssues(body)
        if (publishIssues && publishIssues.length > 0) {
          useWorkflowEditor.getState().setPublishIssues(publishIssues)
          toast.error(
            `Simulation blocked: ${publishIssues.length} validation ${publishIssues.length === 1 ? "issue" : "issues"}`,
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
            open.includes("sources") ? open : ["sources", ...open],
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

      {/* Sources + Output as an accordion so a running/finished run can hand
          the space over to the Output. The whole body scrolls. */}
      <Accordion
        type="multiple"
        value={openSections}
        onValueChange={setOpenSections}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4"
      >
        <AccordionItem value="sources">
          <AccordionTrigger className="py-3">Sources (Inputs)</AccordionTrigger>
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
          <AccordionTrigger className="py-3">Output</AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="min-h-64 rounded-md border border-border bg-muted/30 p-3">
              <SimulatorOutput
                phase={phase}
                prepMessage={prepMessage}
                engineTarget={activeRun?.run.engineTarget ?? null}
                startedAt={activeRun?.run.startedAt ?? null}
                progress={progress}
                run={runDetail}
                ranDefinition={ranDefinition}
                webcam={webcamEntry ? webcamIngest : null}
              />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="shrink-0 border-t border-border p-3">
        <Button
          type="button"
          className="w-full gap-1.5"
          onClick={runWorkflow}
          disabled={running}
        >
          {running ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <PlayIcon className="size-3.5" />
          )}
          {phase === "preparing"
            ? (prepMessage ?? "Starting…")
            : phase === "running"
              ? "Running…"
              : "Run Workflow"}
        </Button>
      </div>

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
