// Pure geometry for the annotator (design §5): image-space boxes, the
// stage transform (pan and zoom), hit tests, handle math and the keyboard
// map. No DOM, no React; covered by annotation-geometry.test.ts so the
// interaction layer can stay thin.

export interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Point {
  x: number
  y: number
}

/** The stage transform: screen = image * scale + offset. */
export interface Transform {
  scale: number
  tx: number
  ty: number
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"
export const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]

export const MIN_SCALE = 0.05
export const MAX_SCALE = 16
/** A drawn box smaller than this (in image px) is a click, not a box. */
export const MIN_BOX_SIZE = 3

/** Sorts the corners so x1 <= x2 and y1 <= y2. */
export function normalizeBox(b: Box): Box {
  return {
    x1: Math.min(b.x1, b.x2),
    y1: Math.min(b.y1, b.y2),
    x2: Math.max(b.x1, b.x2),
    y2: Math.max(b.y1, b.y2),
  }
}

/** Keeps every edge inside [0, width] x [0, height]. */
export function clampBox(b: Box, width: number, height: number): Box {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max)
  return {
    x1: clamp(b.x1, width),
    y1: clamp(b.y1, height),
    x2: clamp(b.x2, width),
    y2: clamp(b.y2, height),
  }
}

export function boxWidth(b: Box): number {
  return b.x2 - b.x1
}
export function boxHeight(b: Box): number {
  return b.y2 - b.y1
}
export function boxArea(b: Box): number {
  return Math.max(0, boxWidth(b)) * Math.max(0, boxHeight(b))
}

/** True when the box has at least MIN_BOX_SIZE on both sides. */
export function isBoxUsable(b: Box): boolean {
  return boxWidth(b) >= MIN_BOX_SIZE && boxHeight(b) >= MIN_BOX_SIZE
}

/** Rounds every edge to one decimal, the precision the API stores. */
export function roundBox(b: Box): Box {
  const r = (v: number) => Math.round(v * 10) / 10
  return { x1: r(b.x1), y1: r(b.y1), x2: r(b.x2), y2: r(b.y2) }
}

export function containsPoint(b: Box, p: Point, tolerance = 0): boolean {
  return (
    p.x >= b.x1 - tolerance &&
    p.x <= b.x2 + tolerance &&
    p.y >= b.y1 - tolerance &&
    p.y <= b.y2 + tolerance
  )
}

/**
 * Which box a click lands on: the SMALLEST box containing the point, so a
 * box nested inside a larger one stays selectable. Returns the index, or -1.
 */
export function hitTestBoxes(boxes: readonly Box[], p: Point, tolerance = 0): number {
  let best = -1
  let bestArea = Infinity
  boxes.forEach((b, i) => {
    if (!containsPoint(b, p, tolerance)) return
    const area = boxArea(b)
    if (area < bestArea) {
      bestArea = area
      best = i
    }
  })
  return best
}

export function handlePosition(b: Box, h: Handle): Point {
  const cx = (b.x1 + b.x2) / 2
  const cy = (b.y1 + b.y2) / 2
  switch (h) {
    case "nw":
      return { x: b.x1, y: b.y1 }
    case "n":
      return { x: cx, y: b.y1 }
    case "ne":
      return { x: b.x2, y: b.y1 }
    case "e":
      return { x: b.x2, y: cy }
    case "se":
      return { x: b.x2, y: b.y2 }
    case "s":
      return { x: cx, y: b.y2 }
    case "sw":
      return { x: b.x1, y: b.y2 }
    case "w":
      return { x: b.x1, y: cy }
  }
}

/** The handle under the point (within `radius`, image px), or null. */
export function handleAt(b: Box, p: Point, radius: number): Handle | null {
  let best: Handle | null = null
  let bestDist = Infinity
  for (const h of HANDLES) {
    const pos = handlePosition(b, h)
    const d = Math.hypot(pos.x - p.x, pos.y - p.y)
    if (d <= radius && d < bestDist) {
      bestDist = d
      best = h
    }
  }
  return best
}

/**
 * Moves the edge(s) a handle owns by (dx, dy). The result is normalized, so
 * dragging a corner past the opposite one flips the box rather than
 * inverting it, and clamped to the image.
 */
export function resizeBox(
  b: Box,
  h: Handle,
  dx: number,
  dy: number,
  width: number,
  height: number,
): Box {
  const next = { ...b }
  if (h.includes("n")) next.y1 += dy
  if (h.includes("s")) next.y2 += dy
  if (h.includes("w")) next.x1 += dx
  if (h.includes("e")) next.x2 += dx
  return clampBox(normalizeBox(next), width, height)
}

/** Translates the box, stopping at the image edges without shrinking it. */
export function moveBox(b: Box, dx: number, dy: number, width: number, height: number): Box {
  const w = boxWidth(b)
  const hgt = boxHeight(b)
  const x1 = Math.min(Math.max(b.x1 + dx, 0), Math.max(0, width - w))
  const y1 = Math.min(Math.max(b.y1 + dy, 0), Math.max(0, height - hgt))
  return { x1, y1, x2: x1 + w, y2: y1 + hgt }
}

// --- xyxy <-> xywh -----------------------------------------------------------------

export function toXywh(b: Box): { x: number; y: number; w: number; h: number } {
  return { x: b.x1, y: b.y1, w: boxWidth(b), h: boxHeight(b) }
}
export function fromXywh(r: { x: number; y: number; w: number; h: number }): Box {
  return { x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y + r.h }
}

// --- stage transform ----------------------------------------------------------------

export function screenToImage(p: Point, t: Transform): Point {
  return { x: (p.x - t.tx) / t.scale, y: (p.y - t.ty) / t.scale }
}
export function imageToScreen(p: Point, t: Transform): Point {
  return { x: p.x * t.scale + t.tx, y: p.y * t.scale + t.ty }
}

/** The transform that letterboxes the whole image into the view, centered. */
export function fitTransform(
  imageW: number,
  imageH: number,
  viewW: number,
  viewH: number,
  padding = 0,
): Transform {
  if (imageW <= 0 || imageH <= 0 || viewW <= 0 || viewH <= 0) return { scale: 1, tx: 0, ty: 0 }
  const scale = Math.min((viewW - 2 * padding) / imageW, (viewH - 2 * padding) / imageH)
  const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
  return {
    scale: s,
    tx: (viewW - imageW * s) / 2,
    ty: (viewH - imageH * s) / 2,
  }
}

/**
 * Zooms by `factor` keeping the screen point `anchor` over the same image
 * point (wheel zoom under the cursor). Clamped to [MIN_SCALE, MAX_SCALE].
 */
export function zoomAt(t: Transform, factor: number, anchor: Point): Transform {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.scale * factor))
  if (scale === t.scale) return t
  const img = screenToImage(anchor, t)
  return {
    scale,
    tx: anchor.x - img.x * scale,
    ty: anchor.y - img.y * scale,
  }
}

export function panBy(t: Transform, dx: number, dy: number): Transform {
  return { ...t, tx: t.tx + dx, ty: t.ty + dy }
}

// --- keyboard map --------------------------------------------------------------------
// One table so the help popover and the docs print the same thing.

export interface KeyBinding {
  keys: string
  action: string
}

export const KEYBOARD_MAP: readonly KeyBinding[] = [
  { keys: "Drag", action: "Draw a box in the selected class" },
  { keys: "Click", action: "Select a box" },
  { keys: "Drag box / handle", action: "Move / resize the selected box" },
  { keys: "1 to 9", action: "Switch class (also re-classes the selected box)" },
  { keys: "Delete / Backspace", action: "Delete the selected box" },
  { keys: "Esc", action: "Deselect, or cancel the box being drawn" },
  { keys: "A", action: "Accept every pre-label on this image" },
  { keys: "R", action: "Reject every pre-label on this image" },
  { keys: "Enter", action: "Accept pre-labels, mark labeled and go to the next image" },
  { keys: "[ / ]  or  ← / →", action: "Previous / next image" },
  { keys: "Scroll", action: "Zoom under the cursor" },
  { keys: "Space + drag, or middle drag", action: "Pan" },
  { keys: "F", action: "Fit the image to the stage" },
  { keys: "N", action: "Add a class without leaving the annotator" },
  { keys: "?", action: "Show this help" },
]

/** The class index a digit key selects (1-based keys, 0-based index), or null. */
export function classIndexForKey(key: string, classCount: number): number | null {
  if (!/^[1-9]$/.test(key)) return null
  const idx = Number(key) - 1
  return idx < classCount ? idx : null
}
