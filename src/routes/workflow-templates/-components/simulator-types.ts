import type { Device, Recording } from "@/lib/api"
import type { ManualWindow } from "@/lib/device-workflow-schemas"
import type { WorkflowDefinition } from "@/lib/workflow-schemas"

// Display name for a device: its label falls back to the serial.
export function deviceLabel(d: Device): string {
  return d.name ?? d.serial
}

// The concrete test input a user binds to one source node in the simulator pane.
// Everything stays client-side (uploaded files become object URLs; device picks
// reference real recordings/devices via read-only APIs) — nothing is uploaded or
// persisted this pass.
export type SourceBinding =
  | { kind: "video-file"; file: File; url: string; name: string }
  | {
      kind: "video-recording"
      deviceId: string
      deviceName: string
      recording: Recording
    }
  | { kind: "csv-file"; file: File; name: string }
  | {
      kind: "device-telemetry"
      deviceId: string
      deviceName: string
      window?: ManualWindow
    }

// The mode dropdown options differ by source group: video sources pick a file or
// a device recording; sensor sources pick a CSV or a device's telemetry.
export type VideoMode = "file" | "recordings"
export type SensorMode = "csv" | "device"

// Video source catalog type; everything else in the "source" group is a sensor.
export function isVideoSource(catalogType: string): boolean {
  return catalogType === "source.video"
}

export function isVideoBinding(
  b: SourceBinding,
): b is Extract<SourceBinding, { kind: "video-file" | "video-recording" }> {
  return b.kind === "video-file" || b.kind === "video-recording"
}

// One-line label for the "bound" chip.
export function bindingLabel(b: SourceBinding): string {
  switch (b.kind) {
    case "video-file":
      return b.name
    case "video-recording":
      return `${b.deviceName} · ${b.recording.streamKey}`
    case "csv-file":
      return b.name
    case "device-telemetry":
      return b.deviceName
  }
}

function formatBytes(bytes: number | null): string | null {
  if (bytes === null || bytes < 0) return null
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

function formatDurationMs(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm ? `${h}h ${mm}m` : `${h}h`
}

function recordingDurationMs(rec: Recording): number | null {
  if (rec.durationMs !== null) return rec.durationMs
  if (rec.endedAt)
    return new Date(rec.endedAt).getTime() - new Date(rec.startedAt).getTime()
  return null
}

// Secondary line for the "bound" chip: duration / size for media, or the window
// for a telemetry pick. Returns null when there's nothing extra to show.
export function bindingMeta(b: SourceBinding): string | null {
  switch (b.kind) {
    case "video-file":
    case "csv-file":
      return formatBytes(b.file.size)
    case "video-recording": {
      const parts = [
        formatDurationMs(recordingDurationMs(b.recording)),
        formatBytes(b.recording.sizeBytes),
      ].filter(Boolean)
      return parts.length ? parts.join(" · ") : null
    }
    case "device-telemetry":
      if (!b.window) return null
      return b.window.mode === "lastN"
        ? `last ${b.window.n} readings`
        : "custom range"
  }
}

// Node types that make a graph "vision" (needs a video recording to run). Mirrors
// the backend's VIDEO_NODE_TYPES routing set in workflow-runner.ts.
const VISION_NODE_TYPES = new Set([
  "source.video",
  "processor.decode_sample",
  "processor.object_detection",
])

export function isVisionGraph(def: WorkflowDefinition): boolean {
  return def.nodes.some((n) => VISION_NODE_TYPES.has(n.type))
}

export interface MockDetection {
  // Relative to the frame (0..1), so the overlay scales with the video element.
  x: number
  y: number
  w: number
  h: number
  label: string
  confidence: number
}

// Deterministic mock bounding boxes for the Frames view. Kept stable (no RNG) so
// the overlay doesn't jitter between renders; gated by the detector node's
// minConfidence so tweaking the graph visibly changes the output.
export function mockDetections(minConfidence: number): MockDetection[] {
  const all: MockDetection[] = [
    { x: 0.08, y: 0.42, w: 0.22, h: 0.34, label: "vehicle", confidence: 0.91 },
    { x: 0.44, y: 0.5, w: 0.16, h: 0.3, label: "vehicle", confidence: 0.83 },
    { x: 0.7, y: 0.38, w: 0.12, h: 0.4, label: "person", confidence: 0.62 },
    { x: 0.34, y: 0.66, w: 0.09, h: 0.16, label: "person", confidence: 0.47 },
  ]
  return all.filter((d) => d.confidence >= minConfidence)
}
