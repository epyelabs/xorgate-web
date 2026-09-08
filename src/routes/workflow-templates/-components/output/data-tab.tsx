import { useEffect, useMemo, useState } from "react"
import { DownloadIcon, EyeIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { WorkflowDefinition } from "@/lib/workflow-schemas"
import type { WorkflowRunDetail } from "@/lib/workflow-run-schemas"
import { formatBytes } from "../simulator-types"
import { ArtifactViewerDialog } from "./artifact-viewer-dialog"
import { FrameThumb, FramesDialog } from "./frames-dialog"
import {
  downloadArtifact,
  fetchArtifactText,
  presign,
  useArtifactSize,
} from "./artifact-fetch"
import {
  buildArtifactGroups,
  inputKeysFromManifest,
  isViewable,
  JSON_VIEW_MAX_BYTES,
  manifestKey,
  type ArtifactEntry,
} from "./run-artifacts"

// Every file the run produced, grouped, each viewable (JSON / JSONL in the
// tree viewer) and downloadable through a presigned URL. Each file row probes
// its own size (header-only); the manifest is read once to list materialized
// inputs. Frames show a small presigned thumbnail strip.

// The annotated frames of one visualization node: a sample strip (first,
// quartiles, last) labelled as such. A thumbnail opens that frame full size
// in the frames dialog; "Show all" opens the dialog on the grid of every
// frame. Nothing leaves the editor page.
function FrameStrip({
  runId,
  nodeId,
  label,
  count,
  sampleSeqs,
}: {
  runId: string
  nodeId: string
  label: string
  count: number
  sampleSeqs: number[]
}) {
  const [dialog, setDialog] = useState<{ open: boolean; seq: number | null }>({ open: false, seq: null })
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1 overflow-x-auto" data-testid={`frame-strip-${nodeId}`}>
        {sampleSeqs.map((seq) => (
          <FrameThumb
            key={seq}
            runId={runId}
            nodeId={nodeId}
            seq={seq}
            onOpen={(s) => setDialog({ open: true, seq: s })}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span data-testid="frame-strip-caption">
          Showing {sampleSeqs.length} of {count} frames ({sampleSeqs.map((s) => `#${s}`).join(", ")}). Click one to view it full size.
        </span>
        {count > sampleSeqs.length ? (
          <Button type="button" variant="ghost" size="xs" onClick={() => setDialog({ open: true, seq: null })}>
            Show all {count}
          </Button>
        ) : null}
      </div>
      <FramesDialog
        runId={runId}
        nodeId={nodeId}
        label={label}
        count={count}
        open={dialog.open}
        initialSeq={dialog.seq}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />
    </div>
  )
}

function ArtifactRow({
  runId,
  entry,
  onView,
}: {
  runId: string
  entry: ArtifactEntry
  onView: (entry: ArtifactEntry) => void
}) {
  const isDirectory = entry.frames !== undefined
  const size = useArtifactSize(runId, isDirectory ? null : entry.key)
  const viewable = isViewable(entry)
  const tooLarge = size !== null && size !== undefined && size > JSON_VIEW_MAX_BYTES
  const isDir = entry.frames !== undefined
  return (
    <div
      className="flex flex-col gap-1.5 rounded-md border border-border px-2.5 py-1.5"
      data-testid={`artifact-${entry.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-foreground">
            {entry.label}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {entry.meta}
            {size !== null && size !== undefined ? ` · ${formatBytes(size)}` : ""}
          </span>
          <span className="block truncate font-mono text-[10px] text-muted-foreground/70" title={entry.key}>
            {entry.key}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {viewable ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onView(entry)}
              disabled={tooLarge}
              title={tooLarge ? `Larger than ${formatBytes(JSON_VIEW_MAX_BYTES)}: download only` : "View"}
              aria-label={`View ${entry.label}`}
            >
              <EyeIcon className="size-3.5" />
            </Button>
          ) : null}
          {!isDir ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void downloadArtifact(runId, entry.key)}
              title="Download"
              aria-label={`Download ${entry.label}`}
            >
              <DownloadIcon className="size-3.5" />
            </Button>
          ) : null}
        </span>
      </div>
      {entry.frames && entry.nodeId ? (
        <div className="flex flex-col gap-1">
          <FrameStrip
            runId={runId}
            nodeId={entry.nodeId}
            label={entry.label}
            count={entry.frames.count}
            sampleSeqs={entry.frames.previewSeqs}
          />
        </div>
      ) : null}
    </div>
  )
}

export function DataTab({
  run,
  definition,
  nodeLabels,
}: {
  run: WorkflowRunDetail
  definition: WorkflowDefinition | null
  nodeLabels: Map<string, string>
}) {
  const [manifestInputs, setManifestInputs] = useState<
    { nodeId: string; key: string }[] | null
  >(null)
  const [viewing, setViewing] = useState<ArtifactEntry | null>(null)

  // The manifest names the materialized inputs (Fargate telemetry runs).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const url = await presign(run.id, manifestKey(run.id))
        const res = await fetchArtifactText(url)
        if (cancelled || res.kind !== "text") return
        setManifestInputs(inputKeysFromManifest(JSON.parse(res.text), run.id))
      } catch {
        if (!cancelled) setManifestInputs([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [run.id])

  const groups = useMemo(
    () => buildArtifactGroups({ run, definition, nodeLabels, manifestInputs }),
    [run, definition, nodeLabels, manifestInputs],
  )

  return (
    <div className="flex flex-col gap-3" data-testid="data-tab">
      {groups.map((g) => (
        <div key={g.id} className="flex flex-col gap-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">{g.title}</p>
          {g.entries.map((entry) => (
            <ArtifactRow
              key={entry.id}
              runId={run.id}
              entry={entry}
              onView={setViewing}
            />
          ))}
        </div>
      ))}
      <ArtifactViewerDialog
        runId={run.id}
        entry={viewing}
        onOpenChange={(open) => {
          if (!open) setViewing(null)
        }}
      />
    </div>
  )
}
