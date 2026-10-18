import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import type { ReplayTimeline, StatusRun, UseReplayPlayer } from "@xorgate/react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { STATUS_OVERLAY_STORAGE_KEY } from "@/lib/device-status"
import {
  APPROXIMATE_STATUS_NOTE,
  DeviceStatusKeyList,
} from "@/components/device-status-info"
import { ReplayTimelineBar } from "./replay-timeline"

// No DOM harness in this repo (node env, no RTL): render to static markup and
// assert on what the first paint contains. The overlay preference is read in
// the state initializer, so a stubbed localStorage drives it.
const store = new Map<string, string>()
beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  })
})
afterEach(() => store.clear())

const T0 = 1_760_000_000_000
const TIMELINE = {
  from: T0,
  to: T0 + 100_000,
  segments: [{ startTs: T0, effectiveDurationMs: 100_000 }],
  gaps: [],
  boundaries: [T0],
  partialEnds: [],
} as unknown as ReplayTimeline

const PLAYER = {
  playheadTs: T0 + 10_000,
  playing: false,
  rate: 1,
  skipGaps: true,
} as unknown as UseReplayPlayer

const RUNS: StatusRun[] = [
  { fromTs: T0, toTs: T0 + 40_000, code: 0, source: "insight" },
  { fromTs: T0 + 40_000, toTs: T0 + 60_000, code: 3, source: "insight" },
  { fromTs: T0 + 60_000, toTs: T0 + 100_000, code: 0, source: "insight" },
]

function render(statusRuns: StatusRun[] = RUNS): string {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(ReplayTimelineBar, {
        player: PLAYER,
        timeline: TIMELINE,
        statusRuns,
        statusRunsSource: "insight",
      })
    )
  )
}

// The opening tag of the element carrying a data-testid.
const tag = (html: string, testId: string): string =>
  html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? ""

const segments = (html: string) =>
  html.match(/data-testid="device-status-segment"/g)?.length ?? 0

describe("ReplayTimelineBar device status overlay", () => {
  it("is off by default: toggle unpressed, no track segments", () => {
    const html = render()
    expect(tag(html, "device-status-toggle")).toContain('aria-pressed="false"')
    expect(segments(html)).toBe(0)
    // The colour-key button is reserved but invisible while off.
    const key = tag(html, "device-status-key-button")
    expect(key).toContain('aria-hidden="true"')
    expect(key).toMatch(/class="[^"]*\binvisible\b/)
  })

  it("restores a persisted 'on' and paints one segment per run", () => {
    store.set(STATUS_OVERLAY_STORAGE_KEY, "1")
    const html = render()
    expect(tag(html, "device-status-toggle")).toContain('aria-pressed="true"')
    expect(segments(html)).toBe(3)
    expect(html).toContain('data-code="3"')
    expect(html).toContain("background-color:#a855f7")
    expect(tag(html, "device-status-key-button")).not.toMatch(
      /class="[^"]*\binvisible\b/
    )
  })

  it("keeps the panel's scrubber geometry whether on or off", () => {
    const off = render()
    store.set(STATUS_OVERLAY_STORAGE_KEY, "1")
    const on = render()
    for (const html of [off, on]) {
      expect(html).toContain("group relative h-6 cursor-pointer")
      expect(html).not.toContain("device-status-legend")
      expect(html).not.toContain("approx.")
    }
  })

  it("disables the toggle and paints nothing without status runs", () => {
    store.set(STATUS_OVERLAY_STORAGE_KEY, "1")
    const html = render([])
    const toggle = tag(html, "device-status-toggle")
    expect(toggle).toContain('aria-pressed="false"')
    expect(toggle).toContain('disabled=""')
    expect(segments(html)).toBe(0)
  })
})

describe("DeviceStatusKeyList", () => {
  it("lists every code with its swatch, label and meaning", () => {
    const html = renderToStaticMarkup(
      createElement(DeviceStatusKeyList, { source: "insight" })
    )
    for (const code of [0, 1, 2, 3, 4, 5, 6]) {
      expect(html).toContain(`data-code="${code}"`)
    }
    for (const label of [
      "Healthy",
      "Starting",
      "GPS: waiting for fix",
      "Network recovering",
      "Thermal throttling",
      "Undervoltage",
      "Agent down",
    ]) {
      expect(html).toContain(label)
    }
    expect(html).toContain("background-color:#ef4444")
    expect(html).not.toContain(APPROXIMATE_STATUS_NOTE)
  })

  it("adds the approximation note for overview-built runs", () => {
    const html = renderToStaticMarkup(
      createElement(DeviceStatusKeyList, { source: "overview" })
    )
    expect(html).toContain(
      "Approximate: built from overview buckets, not exact samples."
    )
  })
})
