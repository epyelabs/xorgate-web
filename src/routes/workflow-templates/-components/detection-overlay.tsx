import type { DetectionsPayload } from "@/lib/workflow-sim-schemas"

// Client-side bounding-box overlay for the LIVE webcam view only: the browser
// shows its own camera stream and draws boxes/labels from the engine's
// freshest json:detections record on top while the run is in progress.
// Finished runs play the engine's real output (the muxed visualization MP4,
// output/video-tab.tsx); nothing is drawn client-side for them.

// Per-class overlay colours (border + label chip), roughly matching common
// detector palettes: people red, animals purple, vehicles orange.
const CLASS_COLORS: Record<string, string> = {
  person: "#ef4444",
  dog: "#a855f7",
  cat: "#a855f7",
  car: "#f97316",
  vehicle: "#f97316",
  truck: "#f97316",
  bus: "#f97316",
}
const DEFAULT_CLASS_COLOR = "#10b981"

function classColor(cls: string): string {
  return CLASS_COLORS[cls] ?? DEFAULT_CLASS_COLOR
}

/** Absolutely-positioned boxes + labels for one detections record. */
export function DetectionBoxes({ record }: { record: DetectionsPayload }) {
  const { width, height, boxes } = record
  if (!width || !height) return null
  return (
    <div className="pointer-events-none absolute inset-0">
      {boxes.map((b, i) => {
        const [x1, y1, x2, y2] = b.xyxy
        const color = classColor(b.cls)
        return (
          <div
            key={i}
            className="absolute rounded-[2px] border-2"
            style={{
              left: `${(x1 / width) * 100}%`,
              top: `${(y1 / height) * 100}%`,
              width: `${((x2 - x1) / width) * 100}%`,
              height: `${((y2 - y1) / height) * 100}%`,
              borderColor: color,
            }}
          >
            <span
              className="absolute -top-[15px] left-0 whitespace-nowrap rounded-[2px] px-1 text-[9px] leading-[13px] font-medium text-white"
              style={{ backgroundColor: color }}
            >
              {b.cls} {b.confidence.toFixed(2)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
