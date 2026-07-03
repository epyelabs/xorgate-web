import { useMemo } from "react"
import { Loader2Icon, ScanEyeIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { SimulationResult, WorkflowDefinition } from "@/lib/workflow-schemas"
import {
  isVideoBinding,
  isVisionGraph,
  mockDetections,
  type SourceBinding,
} from "./simulator-types"

// The mocked "Output" area. It adapts to the graph: vision workflows get a Frames
// tab with drawn bounding boxes over the (bound) video, plus Logs / Events;
// sensor-only workflows get a Logs trace + Events. The underlying numbers come
// from the client-side simulate() mock.
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

  // The detector's min-confidence gates which mock boxes are drawn, so tweaking
  // the Object Detection node visibly changes the Frames output.
  const minConfidence = useMemo(() => {
    const det = definition.nodes.find(
      (n) => n.type === "processor.object_detection",
    )
    const v = Number(det?.data.config?.minConfidence)
    return Number.isFinite(v) ? v : 0.4
  }, [definition])

  // First uploaded video, if any, backs the Frames preview. Device recordings
  // would need a presigned fetch, so those fall back to a placeholder frame.
  const frameUrl = useMemo(() => {
    for (const b of Object.values(bindings)) {
      if (isVideoBinding(b) && b.kind === "video-file") return b.url
    }
    return null
  }, [bindings])

  if (running) {
    return (
      <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2Icon className="size-5 animate-spin" />
        <p className="text-xs">Running workflow…</p>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
        <ScanEyeIcon className="size-5" />
        <p className="text-xs">
          Bind your sources, then run the workflow to see output here.
        </p>
      </div>
    )
  }

  const detections = vision ? mockDetections(minConfidence) : []

  return (
    <Tabs defaultValue={vision ? "frames" : "logs"} className="h-full gap-2">
      <TabsList variant="line" className="w-full justify-start">
        {vision ? <TabsTrigger value="frames">Frames</TabsTrigger> : null}
        <TabsTrigger value="logs">Logs</TabsTrigger>
        <TabsTrigger value="events">
          Events
          {result.events.length ? (
            <Badge variant="secondary" className="ml-1">
              {result.events.length}
            </Badge>
          ) : null}
        </TabsTrigger>
      </TabsList>

      {vision ? (
        <TabsContent value="frames" className="flex flex-col gap-2">
          <div className="relative w-full overflow-hidden rounded-md border border-border bg-black">
            {frameUrl ? (
              <video
                src={frameUrl}
                muted
                playsInline
                className="aspect-video w-full object-contain"
              />
            ) : (
              <div className="aspect-video w-full bg-gradient-to-br from-zinc-800 to-zinc-900" />
            )}
            {/* Bounding-box overlay (relative coords scale with the frame). */}
            <div className="pointer-events-none absolute inset-0">
              {detections.map((d, i) => (
                <div
                  key={i}
                  className="absolute rounded-sm border-2 border-emerald-400/90"
                  style={{
                    left: `${d.x * 100}%`,
                    top: `${d.y * 100}%`,
                    width: `${d.w * 100}%`,
                    height: `${d.h * 100}%`,
                  }}
                >
                  <span className="absolute -top-4 left-0 rounded-sm bg-emerald-400 px-1 text-[10px] font-medium text-black">
                    {d.label} {d.confidence.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {detections.length} detection{detections.length === 1 ? "" : "s"} ≥{" "}
            {minConfidence} confidence · simulated
          </p>
        </TabsContent>
      ) : null}

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
    </Tabs>
  )
}
