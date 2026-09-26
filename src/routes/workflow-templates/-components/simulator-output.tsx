import { useEffect, useMemo, useRef, useState } from "react"
import {
  CheckIcon,
  FolderIcon,
  ListIcon,
  Loader2Icon,
  MinusIcon,
  PlayIcon,
  ScanEyeIcon,
  XIcon,
  ZapIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { WorkflowDefinition } from "@/lib/workflow-schemas"
import type {
  RunStepStatus,
  WorkflowRunDetail,
} from "@/lib/workflow-run-schemas"
import {
  detectionsPayloadSchema,
  type DetectionsPayload,
  type SimEvent,
} from "@/lib/workflow-sim-schemas"
import type { SimProgress } from "@/hooks/use-sim-progress"
import type { WebcamIngest } from "@/hooks/use-webcam-ingest"
import { DetectionBoxes } from "./detection-overlay"
import type { SimPhase } from "./simulator-panel"
import { formatSeconds } from "./simulator-types"
import { DataTab } from "./output/data-tab"
import { EventsTab } from "./output/events-tab"
import { RunHeader, stepCounts } from "./output/run-header"
import { TraceTab } from "./output/trace-tab"
import { VideoTab } from "./output/video-tab"
import { buildArtifactGroups, videoNodes } from "./output/run-artifacts"

// The simulator "Output" area, backed by a REAL run: while in flight it shows
// the live step trace / events / preview frames arriving over IoT WSS; once
// the run row lands it flips to the engine's actual artifacts (run header,
// the muxed visualization MP4, the step accordion, the event accordion, and
// every file under the run prefix, viewable and downloadable).

function StepStatusIcon({ status }: { status: RunStepStatus }) {
  if (status === "ok") return <CheckIcon className="size-3 text-emerald-600" />
  if (status === "failed") return <XIcon className="size-3 text-destructive" />
  return <MinusIcon className="size-3 text-muted-foreground" />
}

// Live trace row (the in-flight view; the landed run uses the accordion).
function LiveStepRow({
  label,
  status,
  output,
  durationMs,
}: {
  label: string
  status: RunStepStatus
  output: string
  durationMs: number
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1 last:border-0">
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="translate-y-px">
          <StepStatusIcon status={status} />
        </span>
        <span className="truncate text-xs font-medium text-foreground">
          {label}
        </span>
      </span>
      <span className="shrink-0 text-right font-mono text-[11px] text-muted-foreground">
        <span className="mr-2 inline-block max-w-48 truncate align-bottom">
          {output}
        </span>
        {formatSeconds(durationMs / 1000)}
      </span>
    </div>
  )
}

function LiveEventRow({ event }: { event: SimEvent }) {
  const at = "occurredAt" in event ? event.occurredAt : ""
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-xs text-foreground">
          {event.kind}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {event.payloadSummary || new Date(at).toLocaleTimeString()}
        </span>
      </span>
      <Badge variant="secondary">{event.confidence.toFixed(2)}</Badge>
    </div>
  )
}

// Seconds elapsed since `since`, ticking; makes the Fargate cold start
// directly readable off the panel (the number that decides the deferred warm
// session task).
function ElapsedSince({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const sec = Math.max(0, Math.round((now - Date.parse(since)) / 1000))
  return <span className="tabular-nums">{sec}s</span>
}

// Live webcam view (M5): the local camera stream with the engine's freshest
// json:detections record overlaid (the records topic runs at live pace during
// live runs, so it IS the overlay driver here, unlike batch replays). Stale
// records (> 2.5 s) expire rather than freezing a box on screen.
const LIVE_RECORD_MAX_AGE_MS = 2500

function latestLiveDetections(progress: SimProgress): DetectionsPayload | null {
  let best: DetectionsPayload | null = null
  let bestTs = -Infinity
  for (const ring of Object.values(progress.records)) {
    for (let i = ring.length - 1; i >= 0; i--) {
      const rec = ring[i]
      if (rec.tag !== "detections") break
      const parsed = detectionsPayloadSchema.safeParse(rec.payload)
      if (parsed.success && parsed.data.ts > bestTs) {
        bestTs = parsed.data.ts
        best = parsed.data
      }
      break // only the newest entry per ring matters
    }
  }
  return best
}

function LiveWebcamView({
  webcam,
  progress,
}: {
  webcam: WebcamIngest
  progress: SimProgress
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (videoRef.current && webcam.stream) {
      videoRef.current.srcObject = webcam.stream
    }
  }, [webcam.stream])

  // Tick so stale overlay records expire even when no new messages arrive.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])
  const record = latestLiveDetections(progress)
  const fresh = record !== null && now - record.ts <= LIVE_RECORD_MAX_AGE_MS

  if (webcam.status === "error") {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
        Webcam ingest failed: {webcam.error}
      </p>
    )
  }
  if (webcam.status === "stopped") {
    return (
      <p className="text-[11px] text-muted-foreground">
        Webcam stopped ({webcam.framesSent} frames sent); waiting for the run to
        drain…
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative w-full overflow-hidden rounded-md border border-border bg-black">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="block aspect-video w-full object-cover"
        />
        {fresh && record ? <DetectionBoxes record={record} /> : null}
        <span className="absolute top-2 left-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
          <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
          LIVE · {webcam.framesSent} frames
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {webcam.status === "publishing"
            ? "Publishing webcam frames to the engine…"
            : "Starting camera…"}
        </span>
        <Button type="button" size="sm" variant="outline" onClick={webcam.stop}>
          <XIcon className="size-3.5" />
          Stop webcam
        </Button>
      </div>
    </div>
  )
}

// Latest engine-rendered preview JPEG per node (the Q2 fallback plane),
// streamed while media graphs run; full-res frames land in S3 and are muxed
// into the output video once the run lands.
function PreviewFrames({
  progress,
  nodeLabels,
}: {
  progress: SimProgress
  nodeLabels: Map<string, string>
}) {
  const previews = Object.values(progress.previews)
  if (previews.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {previews.map((p) => (
        <div
          key={p.nodeId}
          className="relative overflow-hidden rounded-md border border-border bg-black"
        >
          <img
            src={`data:image/jpeg;base64,${p.jpegBase64}`}
            alt={`Preview from ${nodeLabels.get(p.nodeId) ?? p.nodeId}`}
            width={p.width}
            height={p.height}
            className="block h-auto w-full"
          />
          <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {nodeLabels.get(p.nodeId) ?? p.nodeId} · frame {p.frameSeq}
          </span>
        </div>
      ))}
    </div>
  )
}

export function SimulatorOutput({
  phase,
  prepMessage,
  engineTarget,
  startedAt,
  progress,
  run,
  ranDefinition,
  webcam,
}: {
  phase: SimPhase
  prepMessage: string | null
  engineTarget: "lambda" | "fargate" | null
  startedAt: string | null
  progress: SimProgress
  run: WorkflowRunDetail | null
  ranDefinition: WorkflowDefinition | null
  webcam: WebcamIngest | null
}) {
  // Labels from the definition that RAN (the run row's snapshot once it
  // lands; the POSTed definition before that).
  const nodeLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const n of (run?.definition ?? ranDefinition)?.nodes ?? []) {
      map.set(n.id, n.data.label || n.type)
    }
    return map
  }, [run, ranDefinition])

  // --- idle / preparing ---------------------------------------------------------

  if (phase === "idle") {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
        <ScanEyeIcon className="size-5" />
        <p className="text-xs">
          Bind your sources, then run the workflow to see output here.
        </p>
      </div>
    )
  }

  if (phase === "preparing") {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2Icon className="size-5 animate-spin" />
        <p className="text-xs">{prepMessage ?? "Starting simulation…"}</p>
      </div>
    )
  }

  // --- running: live trace + events + previews ----------------------------------

  if (phase === "running") {
    const steps = [...progress.steps].sort((a, b) => a.seq - b.seq)
    // "Cold start" means the ENGINE has not spoken yet. Steps alone are the
    // wrong signal for live runs (nodes only complete when the stream ends,
    // so a webcam run would show "Starting sandbox" for its whole duration);
    // any message on the run's topics means the sandbox is up.
    const engineStarted =
      steps.length > 0 ||
      progress.status !== null ||
      progress.events.length > 0 ||
      Object.keys(progress.records).length > 0 ||
      Object.keys(progress.previews).length > 0
    const coldStarting = engineTarget === "fargate" && !engineStarted
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          <p className="text-xs">
            {coldStarting ? (
              <>
                Starting sandbox (
                {startedAt ? <ElapsedSince since={startedAt} /> : null})… the
                first media run can take a minute while the engine container
                boots.
              </>
            ) : (
              "Running the workflow…"
            )}
          </p>
        </div>
        {progress.connectionError ? (
          <p className="text-[11px] text-muted-foreground">
            Live progress unavailable ({progress.connectionError}); waiting for
            the run to finish.
          </p>
        ) : null}
        {webcam ? <LiveWebcamView webcam={webcam} progress={progress} /> : null}
        {steps.length > 0 ? (
          <div className="flex flex-col">
            {steps.map((s) => (
              <LiveStepRow
                key={s.seq}
                label={nodeLabels.get(s.nodeId) ?? s.label}
                status={s.status}
                output={s.output}
                durationMs={s.durationMs}
              />
            ))}
          </div>
        ) : null}
        {progress.events.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {progress.events.map((ev, i) => (
              <LiveEventRow key={i} event={ev} />
            ))}
          </div>
        ) : null}
        <PreviewFrames progress={progress} nodeLabels={nodeLabels} />
      </div>
    )
  }

  // --- terminal: the run's real artifacts -----------------------------------------

  if (!run) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2Icon className="size-5 animate-spin" />
        <p className="text-xs">Loading results…</p>
      </div>
    )
  }

  // The Video tab exists only for graphs with a node that renders frames
  // (Visualization, Depth Estimation): it plays
  // the muxed MP4, or says why there is none (failed run, older run). A
  // telemetry-only graph has nothing video-related to show, so no tab.
  const hasVideo = Object.keys(run.artifacts?.videos ?? {}).length > 0
  const showVideoTab =
    hasVideo || videoNodes(ranDefinition ?? run.definition, run).length > 0
  const defaultTab = hasVideo && phase !== "failed" ? "video" : "trace"
  const steps = stepCounts(run)
  // Files the Data tab lists (materialized inputs are only known once the tab
  // reads the manifest; they are rare and the badge catches up on open).
  const dataCount = buildArtifactGroups({
    run,
    definition: ranDefinition,
    nodeLabels,
    manifestInputs: null,
  }).reduce((n, g) => n + g.entries.length, 0)

  return (
    <div className="flex flex-col gap-2">
      <RunHeader run={run} nodeLabels={nodeLabels} />

      <Tabs defaultValue={defaultTab} className="gap-2">
        <TabsList variant="line" className="w-full justify-start">
          {showVideoTab ? (
            <TabsTrigger value="video">
              <PlayIcon className="size-3.5" />
              Video
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="trace">
            <ListIcon className="size-3.5" />
            Trace
            <Badge variant="secondary" className="ml-1">
              {steps.ok}/{steps.nodes}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="events">
            <ZapIcon className="size-3.5" />
            Events
            {run.events.length ? (
              <Badge variant="secondary" className="ml-1">
                {run.events.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="artifacts">
            <FolderIcon className="size-3.5" />
            Data
            {dataCount > 0 ? (
              <Badge variant="secondary" className="ml-1">
                {dataCount}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        {showVideoTab ? (
          <TabsContent value="video" className="flex flex-col gap-2">
            <VideoTab
              run={run}
              definition={ranDefinition}
              nodeLabels={nodeLabels}
            />
          </TabsContent>
        ) : null}

        <TabsContent value="trace" className="flex flex-col">
          <TraceTab
            run={run}
            definition={ranDefinition}
            nodeLabels={nodeLabels}
          />
        </TabsContent>

        <TabsContent value="events" className="flex flex-col gap-1.5">
          <EventsTab run={run} />
        </TabsContent>

        <TabsContent value="artifacts" className="flex flex-col gap-1.5">
          <DataTab
            run={run}
            definition={ranDefinition}
            nodeLabels={nodeLabels}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
