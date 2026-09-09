import { useEffect, useState } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  LayoutGridIcon,
  Loader2Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  downloadArtifact,
  presignQueued,
  useArtifactUrl,
} from "./artifact-fetch"
import { frameKey } from "./run-artifacts"

// One presigned thumbnail; presigns itself on mount through the bounded
// queue so a grid of every frame never floods the API. A button, not a link:
// frames open inside the dialog, never in a new tab.
export function FrameThumb({
  runId,
  nodeId,
  seq,
  onOpen,
  width = 96,
  fill = false,
}: {
  runId: string
  nodeId: string
  seq: number
  onOpen: (seq: number) => void
  /** Thumbnail width in px (16:9) when not filling a grid cell. */
  width?: number
  /** Fill the parent grid cell (16:9) instead of a fixed width. */
  fill?: boolean
}) {
  const key = frameKey(runId, nodeId, seq)
  const [url, setUrl] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    presignQueued(runId, key).then(
      (u) => {
        if (!cancelled) setUrl(u)
      },
      () => {}
    )
    return () => {
      cancelled = true
    }
  }, [runId, key])
  return (
    <button
      type="button"
      onClick={() => onOpen(seq)}
      title={`Open frame ${seq}`}
      aria-label={`Open frame ${seq}`}
      className={
        fill
          ? "relative block aspect-video w-full overflow-hidden rounded border border-border bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          : "relative block shrink-0 overflow-hidden rounded border border-border bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      }
      style={fill ? undefined : { width, height: Math.round((width * 9) / 16) }}
      data-loaded={loaded ? "true" : "false"}
    >
      {/* Skeleton until the JPEG has decoded (presign + fetch), like the rest of the app's loading states. */}
      {!loaded ? <Skeleton className="absolute inset-0 rounded-none" /> : null}
      {url ? (
        <img
          src={url}
          alt={`Frame ${seq}`}
          loading="lazy"
          className={
            loaded
              ? "block size-full object-cover"
              : "block size-full object-cover opacity-0"
          }
          onLoad={() => setLoaded(true)}
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.visibility = "hidden"
          }}
        />
      ) : null}
      <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9px] text-white">
        #{seq}
      </span>
    </button>
  )
}

function FrameViewer({
  runId,
  nodeId,
  seq,
  count,
  onSelect,
  onBack,
}: {
  runId: string
  nodeId: string
  seq: number
  count: number
  onSelect: (seq: number) => void
  onBack: () => void
}) {
  const key = frameKey(runId, nodeId, seq)
  const { url, error } = useArtifactUrl(runId, key)
  const prev = seq > 0 ? seq - 1 : null
  const next = seq < count - 1 ? seq + 1 : null
  // The stage never changes size: a fixed 16:9 box shows the last frame that
  // finished loading, with a spinner over it until the next one is decoded.
  const [shown, setShown] = useState<{ url: string; seq: number } | null>(null)
  const loading = url === null || shown?.url !== url
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && prev !== null) onSelect(prev)
      if (e.key === "ArrowRight" && next !== null) onSelect(next)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [prev, next, onSelect])
  return (
    <div
      className="flex h-[72vh] min-h-0 flex-col gap-2"
      data-testid="frame-viewer"
    >
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          <LayoutGridIcon className="size-3" />
          All frames
        </Button>
        <span className="font-mono text-[11px] text-muted-foreground">
          frame #{seq} of {count}
        </span>
        <span className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={prev === null}
            onClick={() => prev !== null && onSelect(prev)}
            aria-label="Previous frame"
          >
            <ChevronLeftIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={next === null}
            onClick={() => next !== null && onSelect(next)}
            aria-label="Next frame"
          >
            <ChevronRightIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void downloadArtifact(runId, key)}
          >
            <DownloadIcon className="size-3" />
            Download
          </Button>
        </span>
      </div>
      <div
        className="relative aspect-video w-full overflow-hidden rounded-md border border-border bg-muted"
        data-testid="frame-stage"
        data-loading={loading ? "true" : "false"}
      >
        {!shown ? <Skeleton className="absolute inset-0 rounded-none" /> : null}
        {shown ? (
          <img
            src={shown.url}
            alt={`Frame ${shown.seq}`}
            className="absolute inset-0 size-full object-contain"
          />
        ) : null}
        {url ? (
          // The incoming frame decodes off-screen; once loaded it becomes the shown one.
          <img
            key={url}
            src={url}
            alt=""
            aria-hidden
            className="absolute inset-0 size-full object-contain opacity-0"
            onLoad={() => setShown({ url, seq })}
          />
        ) : null}
        {error ? (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-destructive">
            Could not load the frame: {error}
          </span>
        ) : loading && shown ? (
          // Navigating: keep the last frame under a spinner so the stage never blanks.
          <span className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Loader2Icon className="size-6 animate-spin text-white" />
          </span>
        ) : null}
      </div>
      <p className="truncate font-mono text-[10px] text-muted-foreground">
        {key}
      </p>
    </div>
  )
}

// The annotated frames of one visualization node, inside the editor: a grid
// of every frame, or one frame full size with prev / next. Opened from the
// Data tab's sample strip ("Show all", or a thumbnail straight to that frame).
export function FramesDialog({
  runId,
  nodeId,
  label,
  count,
  open,
  initialSeq,
  onOpenChange,
}: {
  runId: string
  nodeId: string
  label: string
  count: number
  open: boolean
  // The frame to open on, or null for the grid.
  initialSeq: number | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-2 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {label}: annotated frames
          </DialogTitle>
          {/* Screen readers only: the grid repeats it beside the zoom controls. */}
          <DialogDescription className="sr-only">
            {count} frame{count === 1 ? "" : "s"} the engine rendered for this
            run.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <FramesBody
            key={`${nodeId}:${initialSeq ?? "grid"}`}
            runId={runId}
            nodeId={nodeId}
            count={count}
            initialSeq={initialSeq}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// Grid zoom steps: the MINIMUM column width (px). The grid is
// repeat(auto-fill, minmax(step, 1fr)), so thumbnails always stretch to fill
// the row and the column count follows the dialog width; zoom in = fewer,
// larger columns. The default reads a box label at ~4 columns on a laptop.
const ZOOM_STEPS = [120, 160, 200, 280, 400]
const DEFAULT_ZOOM = 2

function FramesBody({
  runId,
  nodeId,
  count,
  initialSeq,
}: {
  runId: string
  nodeId: string
  count: number
  initialSeq: number | null
}) {
  const [selected, setSelected] = useState<number | null>(initialSeq)
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  if (selected !== null) {
    return (
      <FrameViewer
        runId={runId}
        nodeId={nodeId}
        seq={selected}
        count={count}
        onSelect={setSelected}
        onBack={() => setSelected(null)}
      />
    )
  }
  const width = ZOOM_STEPS[zoom]
  return (
    <div className="flex h-[72vh] min-h-0 flex-col gap-2">
      <div
        className="flex items-center justify-between gap-2"
        data-testid="frames-zoom"
      >
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
          {count} frame{count === 1 ? "" : "s"} the engine rendered for this
          run. Click one to view it full size.
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="mr-1 font-mono text-[10px] text-muted-foreground">
            min {width}px
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={zoom === 0}
            onClick={() => setZoom((z) => Math.max(0, z - 1))}
            aria-label="Zoom out"
            title="Smaller thumbnails"
          >
            <ZoomOutIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={zoom === ZOOM_STEPS.length - 1}
            onClick={() =>
              setZoom((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))
            }
            aria-label="Zoom in"
            title="Larger thumbnails"
          >
            <ZoomInIcon className="size-3.5" />
          </Button>
        </span>
      </div>
      {/* items-start + auto-rows-max: with the default stretch alignment and
          auto rows Chrome sizes the rows before the 16:9 aspect ratio is
          applied and the thumbnails overlap at wider zoom steps. */}
      <div
        className="grid min-h-0 flex-1 auto-rows-max content-start items-start gap-1.5 overflow-y-auto rounded-md border border-border bg-muted/30 p-2"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${width}px, 1fr))`,
        }}
        data-testid="frames-grid"
      >
        {Array.from({ length: count }, (_, seq) => (
          <FrameThumb
            key={seq}
            runId={runId}
            nodeId={nodeId}
            seq={seq}
            fill
            onOpen={setSelected}
          />
        ))}
      </div>
    </div>
  )
}
