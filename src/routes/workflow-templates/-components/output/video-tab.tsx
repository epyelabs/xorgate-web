import { DownloadIcon, Loader2Icon, VideoOffIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { WorkflowDefinition } from "@/lib/workflow-schemas"
import type { WorkflowRunDetail } from "@/lib/workflow-run-schemas"
import { downloadArtifact, useArtifactUrl } from "./artifact-fetch"
import { framesCountFor, videoNodes } from "./run-artifacts"

function OutputVideo({
  runId,
  nodeId,
  label,
  video,
}: {
  runId: string
  nodeId: string
  label: string
  video: { key: string; frames: number; fps: number }
}) {
  const { url, error } = useArtifactUrl(runId, video.key)
  return (
    <div className="flex flex-col gap-1.5" data-testid={`output-video-${nodeId}`}>
      <div className="relative w-full overflow-hidden rounded-md border border-border bg-black">
        {url ? (
          <video src={url} controls autoPlay muted playsInline className="block h-auto w-full" />
        ) : (
          <div className="flex aspect-video items-center justify-center text-xs text-muted-foreground">
            {error ? (
              <span className="text-destructive">Could not load the video: {error}</span>
            ) : (
              <Loader2Icon className="size-4 animate-spin" />
            )}
          </div>
        )}
        <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {label}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[11px] text-muted-foreground">
          Muxed by the engine from {video.frames} annotated frame
          {video.frames === 1 ? "" : "s"} at {video.fps} fps.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void downloadArtifact(runId, video.key)}
        >
          <DownloadIcon className="size-3" />
          Download MP4
        </Button>
      </div>
    </div>
  )
}

// The engine's real visual output: one MP4 per rendering node (Visualization,
// Depth Estimation's colormap), served
// from S3 through the presigned artifact URL. Nothing is drawn client-side.
export function VideoTab({
  run,
  definition,
  nodeLabels,
}: {
  run: WorkflowRunDetail
  definition: WorkflowDefinition | null
  nodeLabels: Map<string, string>
}) {
  const vizNodes = videoNodes(definition ?? run.definition, run)
  if (vizNodes.length === 0) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
        <VideoOffIcon className="size-5" />
        <p className="text-xs">
          This workflow has no node that renders video, so the engine produced
          no output video. Add a Video Visualization output to draw detections,
          masks or depth onto the video.
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {vizNodes.map((viz) => {
        const video = run.artifacts?.videos?.[viz.id]
        const label = nodeLabels.get(viz.id) ?? viz.label
        if (video) {
          return (
            <OutputVideo key={viz.id} runId={run.id} nodeId={viz.id} label={label} video={video} />
          )
        }
        const frames = framesCountFor(run, viz.id)
        return (
          <p
            key={viz.id}
            className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground"
          >
            {run.status === "failed"
              ? `The run failed before ${label} could be muxed into a video.`
              : run.status === "cancelled"
                ? `The run was cancelled before ${label} could be muxed into a video.`
                : frames
                ? `${label} wrote ${frames} annotated frame${frames === 1 ? "" : "s"} but no video was muxed for this run (see the Data tab for the frames).`
                : `${label} produced no annotated frames on this run.`}
          </p>
        )
      })}
    </div>
  )
}
