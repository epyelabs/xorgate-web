import type { WorkflowDefinition } from "@/lib/workflow-schemas"
import type { WorkflowRunDetail } from "@/lib/workflow-run-schemas"

// The run artifact inventory (pure; unit-tested). Mirrors the engine's key
// layout under workflows/v2/runs/<runId>/ (`@xorgate/workflow-engine`
// docs/compatibility.md "Artifact keys") plus the platform's one addition,
// video/<nodeId>.mp4. Everything listed here is reachable through
// GET /workflow-runs/{id}/artifact-url, which presigns any key under the
// run's own prefix.

export const V2_RUN_PREFIX = "workflows/v2/runs/"
export const VISUALIZATION_TYPE = "output.visualization"
// In-browser parse cap for the JSON viewer; larger files are download-only.
export const JSON_VIEW_MAX_BYTES = 5 * 1024 * 1024

export function runPrefix(runId: string): string {
  return `${V2_RUN_PREFIX}${runId}/`
}
export function manifestKey(runId: string): string {
  return `${runPrefix(runId)}manifest.json`
}
export function resultKey(runId: string): string {
  return `${runPrefix(runId)}result.json`
}
export function frameKey(runId: string, nodeId: string, seq: number): string {
  return `${runPrefix(runId)}frames/${nodeId}/${seq}.jpg`
}

// Download name: the path under the run prefix with separators folded (the
// backend signs the same name into Content-Disposition for download=1).
export function artifactFileName(runId: string, key: string): string {
  const prefix = runPrefix(runId)
  const rel = key.startsWith(prefix) ? key.slice(prefix.length) : key
  return (
    rel
      .split("/")
      .filter(Boolean)
      .join("-")
      .replace(/[^A-Za-z0-9._-]/g, "_") || "artifact"
  )
}

export type ArtifactFormat = "json" | "jsonl" | "mp4" | "jpg"

export interface ArtifactEntry {
  id: string
  key: string
  label: string
  meta: string
  format: ArtifactFormat
  nodeId?: string
  // Frames are a directory of JPEGs; `frames` carries the count and the
  // seqs worth previewing (first, quartiles, last).
  frames?: { count: number; previewSeqs: number[] }
}

export interface ArtifactGroup {
  id: "records" | "events" | "run" | "inputs" | "frames" | "videos"
  title: string
  entries: ArtifactEntry[]
}

export function isViewable(entry: ArtifactEntry): boolean {
  return entry.format === "json" || entry.format === "jsonl"
}

export function visualizationNodes(
  definition: WorkflowDefinition | null,
): { id: string; label: string }[] {
  if (!definition) return []
  return definition.nodes
    .filter((n) => n.type === VISUALIZATION_TYPE)
    .map((n) => ({ id: n.id, label: n.data.label || n.type }))
}

// How many annotated frames a visualization node wrote: the muxed video's
// count when the host recorded one, else the step summary ("50 annotated
// frame(s)"), else unknown.
export function framesCountFor(run: WorkflowRunDetail, nodeId: string): number | null {
  const video = run.artifacts?.videos?.[nodeId]
  if (video) return video.frames
  const step = run.steps.find((s) => s.nodeId === nodeId)
  const m = /(\d+) annotated frame/.exec(step?.output ?? "")
  return m ? Number(m[1]) : null
}

// Frame seqs are contiguous from 0 (decode_sample numbers sampled frames);
// preview the first, the quartiles and the last.
export function previewSeqs(count: number, max = 5): number[] {
  if (count <= 0) return []
  if (count <= max) return Array.from({ length: count }, (_, i) => i)
  const seqs = new Set<number>()
  for (let i = 0; i < max; i++) {
    seqs.add(Math.round((i * (count - 1)) / (max - 1)))
  }
  return [...seqs].sort((a, b) => a - b)
}

// Materialized inputs (`inputs/<nodeId>/records.jsonl`, Fargate telemetry
// runs) are named only inside manifest.json's bindings; walk each binding for
// string values under the run's inputs/ prefix rather than knowing every
// binding kind.
export function inputKeysFromManifest(
  manifest: unknown,
  runId: string,
): { nodeId: string; key: string }[] {
  const out: { nodeId: string; key: string }[] = []
  const inputsPrefix = `${runPrefix(runId)}inputs/`
  const inputs = (manifest as { inputs?: unknown })?.inputs
  if (!Array.isArray(inputs)) return out
  for (const input of inputs) {
    const nodeId = (input as { nodeId?: unknown })?.nodeId
    if (typeof nodeId !== "string") continue
    const seen = new Set<string>()
    const walk = (v: unknown) => {
      if (typeof v === "string") {
        if (v.startsWith(inputsPrefix) && !seen.has(v)) {
          seen.add(v)
          out.push({ nodeId, key: v })
        }
      } else if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === "object") Object.values(v).forEach(walk)
    }
    walk((input as { binding?: unknown }).binding)
  }
  return out
}

export function buildArtifactGroups(args: {
  run: WorkflowRunDetail
  definition: WorkflowDefinition | null
  nodeLabels: Map<string, string>
  manifestInputs: { nodeId: string; key: string }[] | null
}): ArtifactGroup[] {
  const { run, definition, nodeLabels, manifestInputs } = args
  const label = (nodeId: string) => nodeLabels.get(nodeId) ?? nodeId
  const groups: ArtifactGroup[] = []

  const records: ArtifactEntry[] = []
  for (const [nodeId, out] of Object.entries(run.artifacts?.outputs ?? {})) {
    records.push({
      id: `records:${nodeId}`,
      key: out.recordsKey,
      label: label(nodeId),
      meta: `${out.count} record${out.count === 1 ? "" : "s"} · ${out.format}`,
      format: out.format === "json" ? "json" : "jsonl",
      nodeId,
    })
  }
  if (records.length > 0)
    groups.push({ id: "records", title: "Captured records", entries: records })

  if (run.artifacts?.eventsKey) {
    groups.push({
      id: "events",
      title: "Events",
      entries: [
        {
          id: "events",
          key: run.artifacts.eventsKey,
          label: "events.jsonl",
          meta: `${run.events.length} event${run.events.length === 1 ? "" : "s"} with payloads`,
          format: "jsonl",
        },
      ],
    })
  }

  const videos: ArtifactEntry[] = []
  const frames: ArtifactEntry[] = []
  for (const viz of visualizationNodes(definition ?? run.definition)) {
    const video = run.artifacts?.videos?.[viz.id]
    const count = framesCountFor(run, viz.id)
    if (count !== null && count > 0) {
      frames.push({
        id: `frames:${viz.id}`,
        key: `${runPrefix(run.id)}frames/${viz.id}/`,
        label: label(viz.id),
        meta: `${count} annotated frame${count === 1 ? "" : "s"} · jpg`,
        format: "jpg",
        nodeId: viz.id,
        frames: { count, previewSeqs: previewSeqs(count) },
      })
    }
    if (video) {
      videos.push({
        id: `video:${viz.id}`,
        key: video.key,
        label: label(viz.id),
        meta: `${video.frames} frame${video.frames === 1 ? "" : "s"} @ ${video.fps} fps · mp4`,
        format: "mp4",
        nodeId: viz.id,
      })
    }
  }
  if (videos.length > 0)
    groups.push({ id: "videos", title: "Output video", entries: videos })
  if (frames.length > 0)
    groups.push({ id: "frames", title: "Annotated frames", entries: frames })

  if (manifestInputs && manifestInputs.length > 0) {
    groups.push({
      id: "inputs",
      title: "Materialized inputs",
      entries: manifestInputs.map((i) => ({
        id: `input:${i.nodeId}`,
        key: i.key,
        label: label(i.nodeId),
        meta: "telemetry window the engine read · jsonl",
        format: "jsonl",
        nodeId: i.nodeId,
      })),
    })
  }

  groups.push({
    id: "run",
    title: "Run",
    entries: [
      {
        id: "result",
        key: resultKey(run.id),
        label: "result.json",
        meta: "engine result (steps, events, metrics, artifacts)",
        format: "json",
      },
      {
        id: "manifest",
        key: manifestKey(run.id),
        label: "manifest.json",
        meta: "run manifest (definition, bindings, window, limits)",
        format: "json",
      },
    ],
  })

  return groups
}
