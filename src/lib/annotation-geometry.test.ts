import { describe, expect, it } from "vitest"
import {
  classIndexForKey,
  clampBox,
  fitTransform,
  fromXywh,
  handleAt,
  handlePosition,
  hitTestBoxes,
  imageToScreen,
  isBoxUsable,
  KEYBOARD_MAP,
  MAX_SCALE,
  MIN_SCALE,
  moveBox,
  normalizeBox,
  resizeBox,
  roundBox,
  screenToImage,
  toXywh,
  zoomAt,
} from "./annotation-geometry"

describe("boxes", () => {
  it("normalizes inverted corners", () => {
    expect(normalizeBox({ x1: 10, y1: 20, x2: 2, y2: 4 })).toEqual({ x1: 2, y1: 4, x2: 10, y2: 20 })
  })

  it("clamps every edge into the image", () => {
    expect(clampBox({ x1: -5, y1: -1, x2: 1300, y2: 800 }, 1280, 720)).toEqual({
      x1: 0,
      y1: 0,
      x2: 1280,
      y2: 720,
    })
  })

  it("refuses a box that is really a click", () => {
    expect(isBoxUsable({ x1: 0, y1: 0, x2: 2, y2: 50 })).toBe(false)
    expect(isBoxUsable({ x1: 0, y1: 0, x2: 3, y2: 3 })).toBe(true)
  })

  it("rounds to the tenth the API stores", () => {
    expect(roundBox({ x1: 1.26, y1: 2.24, x2: 3.35, y2: 4.449 })).toEqual({ x1: 1.3, y1: 2.2, x2: 3.4, y2: 4.4 })
  })

  it("round-trips xyxy and xywh", () => {
    const b = { x1: 10, y1: 20, x2: 110, y2: 70 }
    expect(toXywh(b)).toEqual({ x: 10, y: 20, w: 100, h: 50 })
    expect(fromXywh(toXywh(b))).toEqual(b)
  })
})

describe("hit tests", () => {
  const big = { x1: 0, y1: 0, x2: 100, y2: 100 }
  const small = { x1: 40, y1: 40, x2: 60, y2: 60 }

  it("picks the smallest box under the point so nested boxes stay selectable", () => {
    expect(hitTestBoxes([big, small], { x: 50, y: 50 })).toBe(1)
    expect(hitTestBoxes([big, small], { x: 10, y: 10 })).toBe(0)
    expect(hitTestBoxes([big, small], { x: 150, y: 150 })).toBe(-1)
  })

  it("honours the tolerance on the edge", () => {
    expect(hitTestBoxes([small], { x: 62, y: 50 })).toBe(-1)
    expect(hitTestBoxes([small], { x: 62, y: 50 }, 3)).toBe(0)
  })

  it("finds handles by proximity and names the right edges", () => {
    expect(handlePosition(big, "se")).toEqual({ x: 100, y: 100 })
    expect(handlePosition(big, "n")).toEqual({ x: 50, y: 0 })
    expect(handleAt(big, { x: 98, y: 101 }, 4)).toBe("se")
    expect(handleAt(big, { x: 50, y: 3 }, 4)).toBe("n")
    expect(handleAt(big, { x: 50, y: 50 }, 4)).toBeNull()
  })
})

describe("resize and move", () => {
  const b = { x1: 10, y1: 10, x2: 50, y2: 50 }

  it("moves only the edges a handle owns", () => {
    expect(resizeBox(b, "e", 5, 99, 200, 200)).toEqual({ x1: 10, y1: 10, x2: 55, y2: 50 })
    expect(resizeBox(b, "nw", -5, -5, 200, 200)).toEqual({ x1: 5, y1: 5, x2: 50, y2: 50 })
    expect(resizeBox(b, "s", 99, 10, 200, 200)).toEqual({ x1: 10, y1: 10, x2: 50, y2: 60 })
  })

  it("flips rather than inverts when a corner crosses the opposite edge", () => {
    expect(resizeBox(b, "e", -60, 0, 200, 200)).toEqual({ x1: 0, y1: 10, x2: 10, y2: 50 })
  })

  it("clamps a resize to the image", () => {
    expect(resizeBox(b, "se", 500, 500, 200, 100)).toEqual({ x1: 10, y1: 10, x2: 200, y2: 100 })
  })

  it("moves without shrinking and stops at the edges", () => {
    expect(moveBox(b, 5, -5, 200, 200)).toEqual({ x1: 15, y1: 5, x2: 55, y2: 45 })
    expect(moveBox(b, 500, 500, 200, 200)).toEqual({ x1: 160, y1: 160, x2: 200, y2: 200 })
    expect(moveBox(b, -500, -500, 200, 200)).toEqual({ x1: 0, y1: 0, x2: 40, y2: 40 })
  })
})

describe("stage transform", () => {
  it("letterboxes the image into the view, centered", () => {
    const t = fitTransform(1280, 720, 640, 640)
    expect(t.scale).toBeCloseTo(0.5)
    expect(t.tx).toBeCloseTo(0)
    expect(t.ty).toBeCloseTo((640 - 360) / 2)
  })

  it("falls back to identity on a degenerate size", () => {
    expect(fitTransform(0, 0, 100, 100)).toEqual({ scale: 1, tx: 0, ty: 0 })
  })

  it("maps screen to image and back", () => {
    const t = { scale: 2, tx: 10, ty: 20 }
    const img = screenToImage({ x: 110, y: 220 }, t)
    expect(img).toEqual({ x: 50, y: 100 })
    expect(imageToScreen(img, t)).toEqual({ x: 110, y: 220 })
  })

  it("zooms around the anchor: the image point under the cursor stays put", () => {
    const t = { scale: 1, tx: 0, ty: 0 }
    const anchor = { x: 100, y: 50 }
    const before = screenToImage(anchor, t)
    const z = zoomAt(t, 2, anchor)
    expect(z.scale).toBe(2)
    const after = screenToImage(anchor, z)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it("clamps the scale range and returns the same transform at the limit", () => {
    const t = { scale: MAX_SCALE, tx: 0, ty: 0 }
    expect(zoomAt(t, 4, { x: 0, y: 0 })).toBe(t)
    expect(zoomAt({ scale: MIN_SCALE, tx: 0, ty: 0 }, 0.1, { x: 0, y: 0 }).scale).toBe(MIN_SCALE)
  })
})

describe("keyboard map", () => {
  it("maps digit keys to class indexes within the class count", () => {
    expect(classIndexForKey("1", 3)).toBe(0)
    expect(classIndexForKey("3", 3)).toBe(2)
    expect(classIndexForKey("4", 3)).toBeNull()
    expect(classIndexForKey("0", 3)).toBeNull()
    expect(classIndexForKey("a", 3)).toBeNull()
  })

  it("documents every binding the annotator handles", () => {
    const actions = KEYBOARD_MAP.map((k) => k.keys)
    for (const needed of ["Enter", "A", "R", "Delete / Backspace", "Esc", "F", "?"]) {
      expect(actions.some((a) => a.includes(needed)), needed).toBe(true)
    }
  })
})
