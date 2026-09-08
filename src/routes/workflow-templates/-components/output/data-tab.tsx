import { useEffect, useMemo, useState } from "react"
import { DownloadIcon, EyeIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { WorkflowDefinition } from "@/lib/workflow-schemas"
import type { WorkflowRunDetail } from "@/lib/workflow-run-schemas"
import { formatBytes } from "../simulator-types"
import { ArtifactViewerDialog } from "./artifact-viewer-dialog"
import {
  downloadArtifact,
  fetchArtifactText,
  presign,
  presignQueued,
  useArtifactSize,
} from "./artifact-fetch"
import {
  buildArtifactGroups,
  frameKey,
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

// One presigned thumbnail; presigns itself on mount through the bounded
// queue so "show all" on a long run never floods the API.
function FrameThumb({ runId, nodeId, seq }: { runId: string; nodeId: string; seq: number }) {
  const key = frameKey(runId, nodeId, seq)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    presignQueued(runId, key).then(
      (u) => {
        if (!cancelled) setUrl(u)
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [runId, key])
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      title={key}
      className="relative block h-14 w-24 shrink-0 overflow-hidden rounded border border-border bg-black"
    >
      {url ? (
        <img
          src={url}
          alt={`Frame ${seq}`}
          loading="lazy"
          className="block size-full object-cover"
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.visibility = "hidden"
          }}
        />
      ) : null}
      <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9px] text-white">
        #{seq}
      </span>
    </a>
  )
}

// The annotated frames of one visualization node: a sample strip (first,
// quartiles, last) labelled as such, or every frame in a wrapping grid.
function FrameStrip({
  runId,
  nodeId,
  count,
  sampleSeqs,
}: {
  runId: string
  nodeId: string
  count: number
  sampleSeqs: number[]
}) {
  const [showAll, setShowAll] = useState(false)
  const seqs = showAll ? Array.from({ length: count }, (_, i) => i) : sampleSeqs
  return (
    <div className="flex flex-col gap-1">
      <div
        className={showAll ? "flex max-h-72 flex-wrap gap-1 overflow-y-auto" : "flex gap-1 overflow-x-auto"}
        data-testid={`frame-strip-${nodeId}`}
      >
        {seqs.map((seq) => (
          <FrameThumb key={seq} runId={runId} nodeId={nodeId} seq={seq} />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span data-testid="frame-strip-caption">
          {showAll
            ? `All ${count} frames. Each opens full size in a new tab.`
            : `Showing ${seqs.length} of ${count} frames (${seqs.map((s) => `#${s}`).join(", ")}). Each opens full size in a new tab.`}
        </span>
        {count > sampleSeqs.length ? (
          <Button type="button" variant="ghost" size="xs" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show sample" : `Show all ${count}`}
          </Button>
        ) : null}
      </div>
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
