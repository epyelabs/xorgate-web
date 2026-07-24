import { describe, expect, it } from "vitest"
import type { MediaSession } from "@/lib/api"
import {
  clusterRuns,
  runReplayBlocked,
  runReplaySearch,
  REPLAY_MAX_SEGMENTS,
} from "./runs"

const T0 = Date.parse("2026-07-20T16:00:00.000Z")

function session(
  partial: Partial<MediaSession> & { id: string; startedAt: string }
): MediaSession {
  return {
    deviceId: "dev-1",
    streamKey: "cam0",
    endedAt: null,
    codec: "h264",
    width: 1920,
    height: 1080,
    fps: 15,
    bitrateKbps: 2000,
    source: "device-offline",
    status: "closed",
    timeSource: "ntp",
    lastSegmentAt: null,
    createdAt: partial.startedAt,
    segmentCount: 10,
    totalBytes: 100_000_000,
    totalDurationMs: 600_000,
    ...partial,
  }
}

const iso = (ms: number) => new Date(ms).toISOString()

// The dual-cam shape: cam1 starts a couple of seconds after cam0 (pipeline
// stagger), both run ~30 min.
const cam0 = session({
  id: "s-cam0",
  startedAt: iso(T0),
  endedAt: iso(T0 + 1_800_000),
  totalDurationMs: 1_800_000,
})
const cam1 = session({
  id: "s-cam1",
  streamKey: "cam1",
  startedAt: iso(T0 + 2_000),
  endedAt: iso(T0 + 1_802_000),
  totalDurationMs: 1_800_000,
})

describe("clusterRuns", () => {
  it("clusters overlapping dual-cam sessions into one run", () => {
    const runs = clusterRuns([cam1, cam0]) // input order irrelevant
    expect(runs).toHaveLength(1)
    expect(runs[0].sessions.map((s) => s.id)).toEqual(["s-cam0", "s-cam1"])
    expect(runs[0].streamKeys).toEqual(["cam0", "cam1"])
    expect(runs[0].fromMs).toBe(T0)
    expect(runs[0].toMs).toBe(T0 + 1_802_000)
    expect(runs[0].segmentCount).toBe(20)
    expect(runs[0].totalBytes).toBe(200_000_000)
  })

  it("joins a capture restart within the gap tolerance", () => {
    const restart = session({
      id: "s-restart",
      startedAt: iso(T0 + 1_830_000), // 28 s after cam1 ends
      endedAt: iso(T0 + 2_400_000),
    })
    const runs = clusterRuns([cam0, cam1, restart])
    expect(runs).toHaveLength(1)
    expect(runs[0].toMs).toBe(T0 + 2_400_000)
  })

  it("splits runs separated by more than the tolerance", () => {
    const later = session({
      id: "s-later",
      startedAt: iso(T0 + 1_863_000), // 61 s after cam1 ends
      endedAt: iso(T0 + 2_400_000),
    })
    const runs = clusterRuns([cam0, cam1, later])
    expect(runs).toHaveLength(2)
    // Newest-first table order.
    expect(runs[0].key).toBe("s-later")
    expect(runs[1].key).toBe("s-cam0")
  })

  it("keeps single sessions as single-session runs", () => {
    const lone = session({
      id: "s-lone",
      startedAt: iso(T0 - 86_400_000),
      endedAt: iso(T0 - 86_400_000 + 60_000),
    })
    const runs = clusterRuns([lone, cam0, cam1])
    expect(runs).toHaveLength(2)
    expect(runs[1].sessions).toEqual([lone])
    expect(runs[1].streamKeys).toEqual(["cam0"])
  })

  it("open sessions (no endedAt) span their uploaded duration and flag the run", () => {
    const open = session({
      id: "s-open",
      status: "open",
      startedAt: iso(T0),
      endedAt: null,
      totalDurationMs: 300_000,
    })
    const runs = clusterRuns([open])
    expect(runs[0].toMs).toBe(T0 + 300_000)
    expect(runs[0].anyOpen).toBe(true)
  })

  it("flags unsynced members", () => {
    const runs = clusterRuns([
      cam0,
      { ...cam1, timeSource: "unsynced" },
    ])
    expect(runs[0].anyUnsynced).toBe(true)
  })

  it("chains overlap transitively (A↔B overlap, B↔C adjacent)", () => {
    const c = session({
      id: "s-c",
      startedAt: iso(T0 + 1_810_000), // within tolerance of cam1's end only
      endedAt: iso(T0 + 2_000_000),
    })
    const runs = clusterRuns([cam0, cam1, c])
    expect(runs).toHaveLength(1)
    expect(runs[0].sessions).toHaveLength(3)
  })
})

describe("runReplaySearch / runReplayBlocked", () => {
  it("produces the ISO range the manifest endpoint expects", () => {
    const [run] = clusterRuns([cam0, cam1])
    expect(runReplaySearch(run)).toEqual({
      from: "2026-07-20T16:00:00.000Z",
      to: "2026-07-20T16:30:02.000Z",
    })
  })

  it("blocks empty, over-long and over-wide runs with a reason", () => {
    const [ok] = clusterRuns([cam0, cam1])
    expect(runReplayBlocked(ok)).toBeNull()

    const [empty] = clusterRuns([
      session({ id: "s-0", startedAt: iso(T0), segmentCount: 0, totalBytes: 0 }),
    ])
    expect(runReplayBlocked(empty)).toMatch(/No segments/)

    const [long] = clusterRuns([
      session({
        id: "s-long",
        startedAt: iso(T0),
        endedAt: iso(T0 + 25 * 3_600_000),
      }),
    ])
    expect(runReplayBlocked(long)).toMatch(/24 h/)

    const [wide] = clusterRuns([
      session({
        id: "s-wide",
        startedAt: iso(T0),
        endedAt: iso(T0 + 3_600_000),
        segmentCount: REPLAY_MAX_SEGMENTS + 1,
      }),
    ])
    expect(runReplayBlocked(wide)).toMatch(/segments/)
  })
})
