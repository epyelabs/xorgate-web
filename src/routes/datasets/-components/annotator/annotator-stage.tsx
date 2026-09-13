import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2Icon } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  clampBox,
  fitTransform,
  handleAt,
  handlePosition,
  HANDLES,
  hitTestBoxes,
  isBoxUsable,
  moveBox,
  normalizeBox,
  panBy,
  resizeBox,
  roundBox,
  screenToImage,
  zoomAt,
  type Box,
  type Handle,
  type Point,
  type Transform,
} from "@/lib/annotation-geometry"
import type { DatasetClass } from "@/lib/models-schemas"

// The stage: an <img> inside a pan-and-zoom container (CSS transform) with an
// SVG layer for the boxes. No annotation library (design §5). Pointer events
// draw, select, move and resize; the wheel zooms under the cursor; space-drag
// or middle-drag pans. Every coordinate the layer stores is in IMAGE pixels;
// the transform is the only place screen pixels exist.

export interface StageBox {
  key: string
  classId: string
  box: Box
  source: "human" | "model" | "import"
  confidence: number | null
}

type Gesture =
  | { kind: "draw"; start: Point; current: Point }
  | { kind: "move"; key: string; start: Point; origin: Box }
  | { kind: "resize"; key: string; handle: Handle; start: Point; origin: Box }
  | { kind: "pan"; start: Point; origin: Transform }

const HANDLE_PX = 8
const HIT_TOLERANCE_PX = 4
const DIM_COLOR = "#94a3b8"

export function AnnotatorStage({
  imageUrl,
  width,
  height,
  boxes,
  classes,
  selectedKey,
  activeClass,
  spaceHeld,
  fitSignal,
  onSelect,
  onChangeBox,
  onDraw,
  onAcceptBox,
  onRejectBox,
  className,
}: {
  imageUrl: string | null
  width: number
  height: number
  boxes: StageBox[]
  classes: DatasetClass[]
  selectedKey: string | null
  activeClass: DatasetClass | null
  spaceHeld: boolean
  /** Bumped to re-fit the image (the F key, a new item). */
  fitSignal: number
  onSelect: (key: string | null) => void
  onChangeBox: (key: string, box: Box) => void
  onDraw: (box: Box) => void
  onAcceptBox: (key: string) => void
  onRejectBox: (key: string) => void
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState<Transform>({ scale: 1, tx: 0, ty: 0 })
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [hoverHandle, setHoverHandle] = useState<Handle | null>(null)
  const classById = new Map(classes.map((c) => [c.id, c]))

  const fit = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    setTransform(fitTransform(width, height, el.clientWidth, el.clientHeight, 12))
  }, [width, height])

  // Fit on mount, on a new image and on request; refit on resize.
  useEffect(() => {
    fit()
  }, [fit, fitSignal, imageUrl])
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => fit())
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoaded(false)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [imageUrl])

  // Wheel zoom must be a non-passive listener to preventDefault the page scroll.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const factor = Math.exp(-e.deltaY * 0.0015)
      setTransform((t) => zoomAt(t, factor, anchor))
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  const toScreen = (e: { clientX: number; clientY: number }): Point => {
    const rect = containerRef.current?.getBoundingClientRect()
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }
  }
  const toImage = (e: { clientX: number; clientY: number }): Point => screenToImage(toScreen(e), transform)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      e.preventDefault()
      ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
      setGesture({ kind: "pan", start: toScreen(e), origin: transform })
      return
    }
    if (e.button !== 0) return
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    const p = toImage(e)
    const tol = HIT_TOLERANCE_PX / transform.scale
    // A handle of the selected box wins over everything under it.
    const selected = boxes.find((b) => b.key === selectedKey)
    if (selected) {
      const h = handleAt(selected.box, p, (HANDLE_PX + 2) / transform.scale)
      if (h) {
        setGesture({ kind: "resize", key: selected.key, handle: h, start: p, origin: selected.box })
        return
      }
    }
    const hit = hitTestBoxes(
      boxes.map((b) => b.box),
      p,
      tol,
    )
    if (hit >= 0) {
      const target = boxes[hit]
      onSelect(target.key)
      setGesture({ kind: "move", key: target.key, start: p, origin: target.box })
      return
    }
    onSelect(null)
    if (!activeClass) return
    setGesture({ kind: "draw", start: p, current: p })
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!gesture) {
      const selected = boxes.find((b) => b.key === selectedKey)
      if (selected) setHoverHandle(handleAt(selected.box, toImage(e), (HANDLE_PX + 2) / transform.scale))
      else if (hoverHandle) setHoverHandle(null)
      return
    }
    if (gesture.kind === "pan") {
      const s = toScreen(e)
      setTransform(panBy(gesture.origin, s.x - gesture.start.x, s.y - gesture.start.y))
      return
    }
    const p = toImage(e)
    if (gesture.kind === "draw") {
      setGesture({ ...gesture, current: p })
    } else if (gesture.kind === "move") {
      onChangeBox(gesture.key, roundBox(moveBox(gesture.origin, p.x - gesture.start.x, p.y - gesture.start.y, width, height)))
    } else if (gesture.kind === "resize") {
      onChangeBox(gesture.key, roundBox(resizeBox(gesture.origin, gesture.handle, p.x - gesture.start.x, p.y - gesture.start.y, width, height)))
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!gesture) return
    ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
    if (gesture.kind === "draw") {
      const box = roundBox(clampBox(normalizeBox({ x1: gesture.start.x, y1: gesture.start.y, x2: gesture.current.x, y2: gesture.current.y }), width, height))
      if (isBoxUsable(box)) onDraw(box)
    }
    setGesture(null)
  }

  const draft =
    gesture?.kind === "draw"
      ? clampBox(normalizeBox({ x1: gesture.start.x, y1: gesture.start.y, x2: gesture.current.x, y2: gesture.current.y }), width, height)
      : null

  const cursor =
    gesture?.kind === "pan" || spaceHeld
      ? "grab"
      : hoverHandle
        ? HANDLE_CURSOR[hoverHandle]
        : gesture?.kind === "move"
          ? "move"
          : "crosshair"

  const s = transform.scale
  const stroke = 2 / s
  const fontSize = 12 / s
  const handleSize = HANDLE_PX / s

  return (
    <div
      ref={containerRef}
      className={cn("relative touch-none overflow-hidden rounded-md border border-border bg-muted/40 select-none", className)}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setGesture(null)}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="annotator-stage"
      data-loaded={loaded ? "true" : "false"}
      data-scale={s.toFixed(3)}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height,
          transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${s})`,
          transformOrigin: "0 0",
        }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            width={width}
            height={height}
            alt=""
            draggable={false}
            className="block"
            style={{ width, height }}
            onLoad={() => setLoaded(true)}
          />
        ) : null}
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="absolute inset-0"
          style={{ overflow: "visible" }}
        >
          {boxes.map((b) => {
            const cls = classById.get(b.classId)
            const color = cls?.color ?? DIM_COLOR
            const isSel = b.key === selectedKey
            const pre = b.source === "model"
            const w = b.box.x2 - b.box.x1
            const h = b.box.y2 - b.box.y1
            return (
              <g key={b.key} data-testid="annotator-box" data-source={b.source} data-class={cls?.name ?? b.classId} data-selected={isSel ? "true" : "false"}>
                <rect
                  x={b.box.x1}
                  y={b.box.y1}
                  width={w}
                  height={h}
                  fill={isSel ? `${color}22` : "transparent"}
                  stroke={color}
                  strokeWidth={isSel ? stroke * 1.5 : stroke}
                  strokeDasharray={pre ? `${6 / s} ${4 / s}` : undefined}
                />
                <text
                  x={b.box.x1}
                  y={b.box.y1 - 3 / s}
                  fontSize={fontSize}
                  fill={color}
                  fontFamily="ui-monospace, monospace"
                  style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.7)", strokeWidth: 3 / s }}
                >
                  {cls?.name ?? "?"}
                  {pre && b.confidence !== null ? ` ${b.confidence.toFixed(2)}` : ""}
                </text>
                {pre ? (
                  <g transform={`translate(${b.box.x2}, ${b.box.y1})`}>
                    <foreignObject x={-56 / s} y={-22 / s} width={56 / s} height={20 / s} style={{ overflow: "visible" }}>
                      <div
                        style={{ transform: `scale(${1 / s})`, transformOrigin: "0 0", width: 56, height: 20 }}
                        className="flex items-center justify-end gap-0.5"
                      >
                        <button
                          type="button"
                          className="rounded bg-emerald-600 px-1 text-[10px] leading-4 text-white"
                          title="Accept this pre-label"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            onAcceptBox(b.key)
                          }}
                          data-testid="accept-box"
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          className="rounded bg-red-600 px-1 text-[10px] leading-4 text-white"
                          title="Reject this pre-label"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            onRejectBox(b.key)
                          }}
                          data-testid="reject-box"
                        >
                          ✕
                        </button>
                      </div>
                    </foreignObject>
                  </g>
                ) : null}
                {isSel
                  ? HANDLES.map((hd) => {
                      const pos = handlePosition(b.box, hd)
                      return (
                        <rect
                          key={hd}
                          x={pos.x - handleSize / 2}
                          y={pos.y - handleSize / 2}
                          width={handleSize}
                          height={handleSize}
                          fill="#fff"
                          stroke={color}
                          strokeWidth={stroke / 2}
                        />
                      )
                    })
                  : null}
              </g>
            )
          })}
          {draft ? (
            <rect
              x={draft.x1}
              y={draft.y1}
              width={draft.x2 - draft.x1}
              height={draft.y2 - draft.y1}
              fill={`${activeClass?.color ?? DIM_COLOR}22`}
              stroke={activeClass?.color ?? DIM_COLOR}
              strokeWidth={stroke}
              strokeDasharray={`${4 / s} ${3 / s}`}
              data-testid="annotator-draft"
            />
          ) : null}
        </svg>
      </div>
      {!loaded ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/30">
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        </span>
      ) : null}
      <span className="pointer-events-none absolute right-1.5 bottom-1.5 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">
        {Math.round(s * 100)}%
      </span>
    </div>
  )
}

const HANDLE_CURSOR: Record<Handle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
}
