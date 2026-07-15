import { useEffect, useRef, useState } from "react"
import type { DetectionsPayload } from "@/lib/workflow-sim-schemas"

// Client-side bounding-box overlay (open question Q2, primary plane): the
// browser plays the bound media locally and draws boxes/labels from the
// engine's ts-aligned json:detections records on top. For batch simulations
// the records come from the post-run Data Capture artifact (the live records
// topic is throttled to live pace and misses most frames by design).

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

// Records are engine-timestamped (epoch ms anchored at the source's start);
// the video timeline is seconds from 0. Anchoring t=0 at the first record's ts
// holds for every batch binding: decode_sample stamps frames from the same
// anchor the first frame got.
function recordAt(
  records: DetectionsPayload[],
  timeSec: number,
): DetectionsPayload | null {
  if (records.length === 0) return null
  const target = records[0].ts + timeSec * 1000
  // Binary search: last record with ts <= target.
  let lo = 0
  let hi = records.length - 1
  if (records[0].ts > target) return null
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (records[mid].ts <= target) lo = mid
    else hi = mid - 1
  }
  const rec = records[lo]
  // A record only covers ~one sample interval; past a 1.5 s gap show nothing
  // rather than a stale box.
  return target - rec.ts <= 1500 ? rec : null
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

/**
 * A locally played video with the detections record set replayed against its
 * timeline. Follows playback with a rAF loop (timeupdate alone is ~4 Hz, too
 * coarse for tracking boxes).
 */
export function DetectionVideo({
  src,
  records,
}: {
  src: string
  records: DetectionsPayload[]
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [current, setCurrent] = useState<DetectionsPayload | null>(null)

  useEffect(() => {
    let raf = 0
    let lastTs = -1
    const tick = () => {
      const v = videoRef.current
      if (v) {
        const rec = recordAt(records, v.currentTime)
        const ts = rec?.ts ?? -1
        if (ts !== lastTs) {
          lastTs = ts
          setCurrent(rec)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [records])

  return (
    <div className="relative w-full overflow-hidden rounded-md border border-border bg-black">
      <video
        ref={videoRef}
        src={src}
        controls
        autoPlay
        muted
        playsInline
        className="block h-auto w-full"
      />
      {current ? <DetectionBoxes record={current} /> : null}
    </div>
  )
}
