import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  CopyIcon,
  ImageIcon,
  Loader2Icon,
  PlayIcon,
  ScanEyeIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getRecordingPlaybackUrl } from "@/lib/api"
import type { SimulationResult, WorkflowDefinition } from "@/lib/workflow-schemas"
import {
  detectorMinConfidence,
  firstVideoBinding,
  formatBytes,
  formatSeconds,
  isVisionGraph,
  type SourceBinding,
} from "./simulator-types"
import {
  buildMockFrames,
  classColor,
  framePredictionsJson,
  type FrameDetection,
} from "./simulator-frames"

const FPS = 30

// Absolutely-positioned bounding boxes over a frame. Coords are frame-relative
// (0..1) so the overlay scales with the video element regardless of its size.
function BoxOverlay({ detections }: { detections: FrameDetection[] }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {detections.map((d) => {
        const color = classColor(d.cls)
        return (
          <div
            key={d.detectionId}
            className="absolute rounded-[2px] border-2"
            style={{
              left: `${d.x * 100}%`,
              top: `${d.y * 100}%`,
              width: `${d.w * 100}%`,
              height: `${d.h * 100}%`,
              borderColor: color,
            }}
          >
            <span
              className="absolute -top-[15px] left-0 whitespace-nowrap rounded-[2px] px-1 text-[9px] leading-[13px] font-medium text-white"
              style={{ backgroundColor: color }}
            >
              {d.cls} {d.confidence.toFixed(2)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// The mocked "Output" area. It adapts to the graph: vision workflows get a Video
// tab (playback with live-tracking boxes) and a Frames tab (per-frame scrubber +
// detection JSON), plus Events; sensor-only workflows get a Logs trace + Events.
// The underlying numbers come from the client-side simulate() mock.
export function SimulatorOutput({
  definition,
  bindings,
  result,
  running,
}: {
  definition: WorkflowDefinition
  bindings: Record<string, SourceBinding>
  result: SimulationResult | null
  running: boolean
}) {
  const vision = isVisionGraph(definition)
  const minConfidence = useMemo(
    () => detectorMinConfidence(definition),
    [definition],
  )
  const videoBinding = useMemo(() => firstVideoBinding(bindings), [bindings])

  // A device recording needs a presigned URL to play; an uploaded file already
  // has an object URL. No URL -> the tabs fall back to a placeholder frame.
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!videoBinding || videoBinding.kind !== "video-recording") return
    let cancelled = false
    /* eslint-disable react-hooks/set-state-in-effect */
    setRecordingUrl(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    ;(async () => {
      try {
        const { url } = await getRecordingPlaybackUrl(
          videoBinding.deviceId,
          videoBinding.recording.id,
        )
        if (!cancelled) setRecordingUrl(url)
      } catch {
        // Leave null; the overlay still renders over a placeholder frame.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [videoBinding])
  const videoUrl =
    videoBinding?.kind === "video-file" ? videoBinding.url : recordingUrl

  // Intrinsic size + duration come from the loaded video; fall back sensibly so
  // the frame timeline exists before metadata arrives (or with no video).
  const [meta, setMeta] = useState<{
    durationSec: number
    width: number
    height: number
  } | null>(null)
  const onLoadedMeta = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget
    setMeta({ durationSec: v.duration, width: v.videoWidth, height: v.videoHeight })
  }
  const fallbackDuration =
    videoBinding?.kind === "video-recording"
      ? (videoBinding.recording.durationMs ?? 12_000) / 1000
      : 12
  const durationSec =
    meta && Number.isFinite(meta.durationSec) ? meta.durationSec : fallbackDuration
  const imageW = meta?.width || 1280
  const imageH = meta?.height || 720

  const frames = useMemo(
    () => buildMockFrames({ durationSec, fps: FPS, minConfidence }),
    [durationSec, minConfidence],
  )
  const frameCount = frames.length

  const liveVideoRef = useRef<HTMLVideoElement>(null)
  const framesVideoRef = useRef<HTMLVideoElement>(null)
  const [liveTime, setLiveTime] = useState(0)
  const [frameIdx, setFrameIdx] = useState(0)

  const sizeBytes =
    videoBinding?.kind === "video-file"
      ? videoBinding.file.size
      : videoBinding?.kind === "video-recording"
        ? videoBinding.recording.sizeBytes
        : null

  if (running) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2Icon className="size-5 animate-spin" />
        <p className="text-xs">Running workflow…</p>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
        <ScanEyeIcon className="size-5" />
        <p className="text-xs">
          Bind your sources, then run the workflow to see output here.
        </p>
      </div>
    )
  }

  // --- shared tab bodies (result is non-null past this point) ---
  const logsTab = (
    <TabsContent value="logs" className="flex flex-col gap-1">
      {result.steps.map((s) => (
        <div
          key={s.nodeId}
          className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1 last:border-0"
        >
          <span className="shrink-0 text-xs font-medium text-foreground">
            {s.label}
          </span>
          <span className="truncate text-right font-mono text-xs text-muted-foreground">
            {s.output}
          </span>
        </div>
      ))}
    </TabsContent>
  )

  const eventsTab = (
    <TabsContent value="events" className="flex flex-col gap-1.5">
      {result.events.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          No events emitted for this run.
        </p>
      ) : (
        result.events.map((ev, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-xs text-foreground">
                {ev.kind}
              </span>
              <span className="text-xs text-muted-foreground">@ {ev.at}</span>
            </span>
            <Badge variant="secondary">{ev.confidence.toFixed(2)}</Badge>
          </div>
        ))
      )}
    </TabsContent>
  )

  const eventsTrigger = (
    <TabsTrigger value="events">
      Events
      {result.events.length ? (
        <Badge variant="secondary" className="ml-1">
          {result.events.length}
        </Badge>
      ) : null}
    </TabsTrigger>
  )

  // Sensor-only graph: no frames to show.
  if (!vision) {
    return (
      <Tabs defaultValue="logs" className="gap-2">
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="logs">Logs</TabsTrigger>
          {eventsTrigger}
        </TabsList>
        {logsTab}
        {eventsTab}
      </Tabs>
    )
  }

  // Vision graph: Video + Frames + Events.
  const liveIdx = Math.min(
    Math.max(0, Math.round(liveTime * FPS)),
    frameCount - 1,
  )
  const liveFrame = frames[liveIdx]
  const fIdx = Math.min(frameIdx, frameCount - 1)
  const frame = frames[fIdx]
  const frameJson = framePredictionsJson(frame, imageW, imageH)

  const copyJson = () => {
    navigator.clipboard
      ?.writeText(frameJson)
      .then(() => toast.success("Frame output copied"))
      .catch(() => toast.error("Couldn't copy"))
  }

  const seekFrames = (idx: number) => {
    setFrameIdx(idx)
    const v = framesVideoRef.current
    if (v && frames[idx]) v.currentTime = frames[idx].timeSec
  }

  return (
    <Tabs defaultValue="video" className="gap-2">
      <TabsList variant="line" className="w-full justify-start">
        <TabsTrigger value="video">
          <PlayIcon className="size-3.5" />
          Video
        </TabsTrigger>
        <TabsTrigger value="frames">
          <ImageIcon className="size-3.5" />
          Frames
        </TabsTrigger>
        {eventsTrigger}
      </TabsList>

      {/* Video: playback with boxes that track the current time. */}
      <TabsContent value="video" className="flex flex-col gap-2">
        <div className="relative w-full overflow-hidden rounded-md border border-border bg-black">
          {videoUrl ? (
            <video
              ref={liveVideoRef}
              src={videoUrl}
              controls
              autoPlay
              muted
              playsInline
              className="block h-auto w-full"
              onLoadedMetadata={onLoadedMeta}
              onTimeUpdate={(e) => setLiveTime(e.currentTarget.currentTime)}
            />
          ) : (
            <div className="aspect-video w-full bg-gradient-to-br from-zinc-800 to-zinc-900" />
          )}
          <BoxOverlay detections={liveFrame.detections} />
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Summary</span>{" "}
          {[
            formatBytes(sizeBytes),
            formatSeconds(durationSec),
            `${frameCount} frames`,
          ]
            .filter(Boolean)
            .join(" · ")}{" "}
          · simulated
        </p>
      </TabsContent>

      {/* Frames: scrub to any frame, with its detection JSON. */}
      <TabsContent value="frames" className="flex flex-col gap-2">
        <div className="relative w-full overflow-hidden rounded-md border border-border bg-black">
          {videoUrl ? (
            <video
              ref={framesVideoRef}
              src={videoUrl}
              muted
              playsInline
              preload="auto"
              className="block h-auto w-full"
              onLoadedMetadata={(e) => {
                onLoadedMeta(e)
                if (frames[fIdx]) e.currentTarget.currentTime = frames[fIdx].timeSec
              }}
            />
          ) : (
            <div className="aspect-video w-full bg-gradient-to-br from-zinc-800 to-zinc-900" />
          )}
          <BoxOverlay detections={frame.detections} />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Frame {fIdx + 1} / {frameCount}
          </span>
          <span>{frame.timeSec.toFixed(2)}s</span>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(0, frameCount - 1)}
          value={fIdx}
          onChange={(e) => seekFrames(Number(e.target.value))}
          aria-label="Frame"
          className="w-full accent-primary"
        />

        <div className="flex flex-col rounded-md border border-border bg-background">
          <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
            <div className="flex flex-col">
              <span className="text-xs font-medium text-foreground">
                Frame Output
              </span>
              <span className="text-[11px] text-muted-foreground">
                Frame {fIdx + 1} of {frameCount}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={copyJson}
              title="Copy frame output"
              aria-label="Copy frame output"
            >
              <CopyIcon className="size-3.5" />
            </Button>
          </div>
          <pre className="overflow-x-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground">
            {frameJson}
          </pre>
        </div>
      </TabsContent>

      {eventsTab}
    </Tabs>
  )
}
