// Mock per-frame object-detection data for the simulator's vision output. Boxes
// oscillate smoothly across the clip (deterministic — no RNG at render time) so
// scrubbing the Frames tab and playing the Video tab both look alive. Everything
// here is simulated; the real per-frame detections come from the CV runner.

export interface FrameDetection {
  // Box in frame-relative coords (0..1), top-left origin — drives the overlay.
  x: number
  y: number
  w: number
  h: number
  cls: string
  classId: number
  confidence: number
  detectionId: string
}

export interface MockFrame {
  index: number
  timeSec: number
  detections: FrameDetection[]
}

// Per-class overlay colours (border + label chip), roughly matching common
// detector palettes: people red, animals purple, vehicles orange.
export const CLASS_COLORS: Record<string, string> = {
  person: "#ef4444",
  dog: "#a855f7",
  car: "#f97316",
  vehicle: "#f97316",
  truck: "#f97316",
}
export const DEFAULT_CLASS_COLOR = "#10b981"

export function classColor(cls: string): string {
  return CLASS_COLORS[cls] ?? DEFAULT_CLASS_COLOR
}

interface Track {
  x0: number
  y0: number
  w: number
  h: number
  ampX: number
  ampY: number
  sx: number
  sy: number
  cls: string
  classId: number
  conf: number
}

// A fixed cast of "objects" in the scene, each drifting on a sine path.
const TRACKS: Track[] = [
  { x0: 0.14, y0: 0.44, w: 0.2, h: 0.36, ampX: 0.03, ampY: 0.01, sx: 0.05, sy: 0.08, cls: "person", classId: 0, conf: 0.91 },
  { x0: 0.02, y0: 0.66, w: 0.1, h: 0.14, ampX: 0.02, ampY: 0.01, sx: 0.06, sy: 0.05, cls: "dog", classId: 16, conf: 0.74 },
  { x0: 0.42, y0: 0.5, w: 0.16, h: 0.28, ampX: 0.02, ampY: 0.01, sx: 0.04, sy: 0.06, cls: "car", classId: 2, conf: 0.83 },
  { x0: 0.58, y0: 0.46, w: 0.22, h: 0.34, ampX: 0.03, ampY: 0.02, sx: 0.03, sy: 0.05, cls: "car", classId: 2, conf: 0.93 },
  { x0: 0.74, y0: 0.42, w: 0.12, h: 0.2, ampX: 0.02, ampY: 0.01, sx: 0.05, sy: 0.07, cls: "car", classId: 2, conf: 0.55 },
  { x0: 0.3, y0: 0.6, w: 0.06, h: 0.12, ampX: 0.02, ampY: 0.01, sx: 0.05, sy: 0.06, cls: "person", classId: 0, conf: 0.47 },
]

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Deterministic uuid-shaped id from a seed, so the JSON looks realistic without
// RNG (stable across re-renders for a given frame/track).
function pseudoUuid(seed: number): string {
  let h = (seed * 2654435761) >>> 0
  const hex = (n: number) => {
    let out = ""
    for (let i = 0; i < n; i++) {
      h = (h * 1664525 + 1013904223) >>> 0
      out += (h & 0xff).toString(16).padStart(2, "0")
    }
    return out
  }
  return `${hex(4)}-${hex(2)}-${hex(2)}-${hex(2)}-${hex(6)}`
}

// Build every frame's detections. `fps` sets the timeline; a track is included
// only if its base confidence clears minConfidence (so membership doesn't flicker
// frame to frame).
export function buildMockFrames(opts: {
  durationSec: number
  fps: number
  minConfidence: number
}): MockFrame[] {
  const { durationSec, fps, minConfidence } = opts
  const count = clamp(Math.round(durationSec * fps), 1, 900)
  const active = TRACKS.filter((t) => t.conf >= minConfidence)
  const frames: MockFrame[] = []
  for (let i = 0; i < count; i++) {
    const detections: FrameDetection[] = active.map((t, ti) => {
      const phase = ti * 0.7
      const x = clamp(t.x0 + t.ampX * Math.sin(i * t.sx + phase), 0, 1 - t.w)
      const y = clamp(t.y0 + t.ampY * Math.sin(i * t.sy + phase), 0, 1 - t.h)
      const conf = clamp(t.conf + 0.03 * Math.sin(i * 0.09 + phase), 0, 1)
      return {
        x,
        y,
        w: t.w,
        h: t.h,
        cls: t.cls,
        classId: t.classId,
        confidence: Math.round(conf * 1000) / 1000,
        detectionId: pseudoUuid(i * 31 + ti * 7 + 1),
      }
    })
    frames.push({ index: i, timeSec: i / fps, detections })
  }
  return frames
}

// Roboflow-style JSON for one frame's detections (x/y are the box centre in
// pixels), shown in the Frames tab's "Frame Output" panel.
export function framePredictionsJson(
  frame: MockFrame,
  imageW: number,
  imageH: number,
): string {
  const r = (n: number) => Math.round(n)
  const predictions = frame.detections.map((d) => ({
    width: r(d.w * imageW),
    height: r(d.h * imageH),
    x: r((d.x + d.w / 2) * imageW),
    y: r((d.y + d.h / 2) * imageH),
    confidence: d.confidence,
    class_id: d.classId,
    class: d.cls,
    detection_id: d.detectionId,
    parent_id: "picture.[0]",
  }))
  return JSON.stringify(
    {
      model_output: {
        image: { width: imageW, height: imageH },
        predictions,
      },
    },
    null,
    2,
  )
}
