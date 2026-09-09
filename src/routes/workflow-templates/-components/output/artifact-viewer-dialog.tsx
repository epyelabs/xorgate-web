import { useEffect, useState } from "react"
import { DownloadIcon, Loader2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { JsonTree } from "@/components/json-tree"
import { formatBytes } from "../simulator-types"
import {
  downloadArtifact,
  fetchArtifactText,
  parseArtifactText,
  presign,
} from "./artifact-fetch"
import { JSON_VIEW_MAX_BYTES, type ArtifactEntry } from "./run-artifacts"

type ViewState =
  | { kind: "loading" }
  | { kind: "ready"; value: unknown; size: number; lines: number | null }
  | { kind: "too-large"; size: number }
  | { kind: "error"; message: string }

const LOADING: ViewState = { kind: "loading" }

// In-app viewer for a JSON / JSONL artifact: presign, fetch under the cap,
// parse (JSONL as an array of lines) and render the collapsible tree.
export function ArtifactViewerDialog({
  runId,
  entry,
  onOpenChange,
}: {
  runId: string
  entry: ArtifactEntry | null
  onOpenChange: (open: boolean) => void
}) {
  // Keyed by the artifact so a new entry reads as loading without a
  // synchronous reset inside the effect.
  const [loaded, setLoaded] = useState<{ key: string; state: ViewState } | null>(null)
  const key = entry?.key ?? null
  const format = entry?.format === "json" ? "json" : "jsonl"
  const state: ViewState = key && loaded?.key === key ? loaded.state : LOADING

  useEffect(() => {
    if (!key) return
    let cancelled = false
    const setState = (next: ViewState) => setLoaded({ key, state: next })
    ;(async () => {
      try {
        const url = await presign(runId, key)
        const res = await fetchArtifactText(url)
        if (cancelled) return
        if (res.kind === "too-large") setState({ kind: "too-large", size: res.size })
        else if (res.kind === "error") setState({ kind: "error", message: res.message })
        else {
          const value = parseArtifactText(res.text, format)
          setState({
            kind: "ready",
            value,
            size: res.size,
            lines: format === "jsonl" && Array.isArray(value) ? value.length : null,
          })
        }
      } catch (err) {
        if (!cancelled) setState({ kind: "error", message: (err as Error).message })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [runId, key, format])

  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-2 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate text-sm">
            {entry?.label ?? "Artifact"}
          </DialogTitle>
          <DialogDescription className="truncate font-mono text-[11px]">
            {entry?.key}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            {state.kind === "ready"
              ? [
                  formatBytes(state.size),
                  state.lines !== null
                    ? `${state.lines} line${state.lines === 1 ? "" : "s"}`
                    : null,
                  format,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : state.kind === "too-large"
                ? `${formatBytes(state.size)} · larger than the ${formatBytes(JSON_VIEW_MAX_BYTES)} in-browser viewer cap`
                : state.kind === "error"
                  ? `Could not load: ${state.message}`
                  : "Loading…"}
          </span>
          {entry ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void downloadArtifact(runId, entry.key)}
            >
              <DownloadIcon className="size-3" />
              Download
            </Button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/30 p-2">
          {state.kind === "loading" ? (
            <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" /> Fetching the artifact…
            </div>
          ) : state.kind === "ready" ? (
            <JsonTree value={state.value} />
          ) : state.kind === "too-large" ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              This file is download-only in the browser. Use the Download button
              to save it.
            </p>
          ) : (
            <p className="py-6 text-center text-xs text-destructive">{state.message}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
