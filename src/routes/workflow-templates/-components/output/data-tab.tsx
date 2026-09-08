import { useEffect, useMemo, useState } from "react"
import { DownloadIcon, EyeIcon, ExternalLinkIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { WorkflowDefinition } from "@/lib/workflow-schemas"
import type { WorkflowRunDetail } from "@/lib/workflow-run-schemas"
import { formatBytes } from "../simulator-types"
import { ArtifactViewerDialog } from "./artifact-viewer-dialog"
import {
  downloadArtifact,
  fetchArtifactText,
  presign,
  probeSize,
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
// tree viewer) and downloadable through a presigned URL. Sizes come from a
// header-only probe per key; the manifest is read once to list materialized
// inputs. Frames show a small presigned thumbnail strip.

function FrameStrip({
  runId,
  nodeId,
  seqs,
}: {
  runId: string
  nodeId: string
  seqs: number[]
}) {
  const [urls, setUrls] = useState<Record<number, string>>({})
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const entries = await Promise.all(
        seqs.map(async (seq) => {
          try {
            return [seq, await presign(runId, frameKey(runId, nodeId, seq))] as const
          } catch {
            return null
          }
        }),
      )
      if (cancelled) return
      const next: Record<number, string> = {}
      for (const e of entries) if (e) next[e[0]] = e[1]
      setUrls(next)
    })()
    return () => {
      cancelled = true
    }
  }, [runId, nodeId, seqs])
  return (
    <div className="flex gap-1 overflow-x-auto" data-testid={`frame-strip-${nodeId}`}>
      {seqs.map((seq) => {
        const url = urls[seq]
        return (
          <a
            key={seq}
            href={url ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            title={frameKey(runId, nodeId, seq)}
            className="relative block h-14 w-24 shrink-0 overflow-hidden rounded border border-border bg-black"
          >
            {url ? (
              <img
                src={url}
                alt={`Frame ${seq}`}
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
      })}
    </div>
  )
}

function ArtifactRow({
  runId,
  entry,
  size,
  onView,
}: {
  runId: string
  entry: ArtifactEntry
  size: number | null | undefined
  onView: (entry: ArtifactEntry) => void
}) {
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
          <FrameStrip runId={runId} nodeId={entry.nodeId} seqs={entry.frames.previewSeqs} />
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <ExternalLinkIcon className="size-2.5" />
            Thumbnails open the full frame; each frame is one object under this prefix.
          </span>
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
  const [sizes, setSizes] = useState<Record<string, number | null>>({})
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

  // Header-only size probe per file (frames are a directory: skipped).
  const fileKeys = useMemo(
    () => groups.flatMap((g) => g.entries.filter((e) => !e.frames).map((e) => e.key)),
    [groups],
  )
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const pending = fileKeys.filter((k) => !(k in sizes))
      if (pending.length === 0) return
      const probed = await Promise.all(
        pending.map(async (key) => {
          try {
            return [key, await probeSize(await presign(run.id, key))] as const
          } catch {
            return [key, null] as const
          }
        }),
      )
      if (cancelled) return
      setSizes((prev) => {
        const next = { ...prev }
        for (const [k, v] of probed) next[k] = v
        return next
      })
    })()
    return () => {
      cancelled = true
    }
    // `sizes` is read to skip probed keys; re-running on its change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id, fileKeys])

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
              size={entry.frames ? undefined : sizes[entry.key]}
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
