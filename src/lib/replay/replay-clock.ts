import {
  clampTs,
  gapAt,
  hasCoverageAt,
  type ReplayTimeline,
} from "@/lib/replay/timeline"

// The master replay clock (composite replays plan, R2 + the README pacing
// contract): ONE wall-clock playhead (epoch ms) that everything on the page
// follows. Nothing reads video.currentTime directly — the video tile
// registers as the pacer and the clock decides when it rules:
//
// - Playing with video coverage at the playhead: the video element PACES the
//   clock (pacer read wins), so A/V-vs-telemetry drift is structurally
//   impossible. A stalled video (cold fetch) freezes the clock — correct,
//   telemetry waits with it.
// - Playing inside a gap / uncovered stretch: the clock free-runs at
//   rate × real time, or jumps manifest gaps when skipGaps is on.
// - Seek/scrub: the user sets the clock; followers re-derive. Discontinuities
//   bump seekSeq so the video tile knows to re-align (a pace tick never does).
//
// Pure logic — the rAF driver lives in the React hook so this stays unit-
// testable with synthetic ticks.

export const REPLAY_RATES = [0.5, 1, 2, 4] as const
export type ReplayRate = (typeof REPLAY_RATES)[number]

export interface GapSkipEvent {
  fromTs: number
  toTs: number
  // Monotonic id so the tile can show a transient "skipped Xs" notice per
  // event without comparing timestamps.
  seq: number
}

export interface ReplayClockState {
  playheadTs: number
  playing: boolean
  rate: ReplayRate
  skipGaps: boolean
  // Bumped on every discontinuity the pacer didn't cause (seek, gap skip,
  // play-from-end restart) — the video tile re-aligns when it changes.
  seekSeq: number
  lastSkip: GapSkipEvent | null
}

export class ReplayClock {
  readonly timeline: ReplayTimeline

  private playheadTs: number
  private playing = false
  private rate: ReplayRate = 1
  private skipGaps = true
  private seekSeq = 0
  private lastSkip: GapSkipEvent | null = null
  private skipCounter = 0

  private pacerRead: (() => number) | null = null
  private readonly subscribers = new Set<() => void>()

  constructor(timeline: ReplayTimeline, startTs?: number) {
    this.timeline = timeline
    this.playheadTs = clampTs(timeline, startTs ?? timeline.from)
  }

  getState(): ReplayClockState {
    return {
      playheadTs: this.playheadTs,
      playing: this.playing,
      rate: this.rate,
      skipGaps: this.skipGaps,
      seekSeq: this.seekSeq,
      lastSkip: this.lastSkip,
    }
  }

  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb)
    return () => this.subscribers.delete(cb)
  }

  private notify(): void {
    for (const cb of this.subscribers) cb()
  }

  // --- commands ---

  play(): void {
    if (this.playing) return
    // Play at the very end restarts from the top (common transport UX).
    if (this.playheadTs >= this.timeline.to) {
      this.playheadTs = this.timeline.from
      this.seekSeq++
    }
    this.playing = true
    this.notify()
  }

  pause(): void {
    if (!this.playing) return
    this.playing = false
    this.notify()
  }

  setRate(rate: ReplayRate): void {
    if (this.rate === rate) return
    this.rate = rate
    this.notify()
  }

  setSkipGaps(skip: boolean): void {
    if (this.skipGaps === skip) return
    this.skipGaps = skip
    this.notify()
  }

  seek(ts: number): void {
    const clamped = clampTs(this.timeline, ts)
    this.playheadTs = clamped
    this.seekSeq++
    this.notify()
  }

  // --- driver inputs ---

  // The video tile registers a reader returning the wall-clock ts its media
  // element currently shows. Only consulted while playing WITH coverage.
  setPacer(read: (() => number) | null): void {
    this.pacerRead = read
  }

  // One driver tick. dtMs = real elapsed ms since the previous tick.
  tick(dtMs: number): void {
    if (!this.playing) return
    if (this.pacerRead && hasCoverageAt(this.timeline, this.playheadTs)) {
      const paced = clampTs(this.timeline, this.pacerRead())
      if (paced !== this.playheadTs) {
        this.playheadTs = paced
        this.endCheck()
        this.notify()
      }
      return
    }
    this.advance(dtMs)
  }

  // Free-run path (no coverage, or no pacer mounted — e.g. telemetry-only
  // replay). Exposed for tests.
  advance(dtMs: number): void {
    if (!this.playing) return
    let next = this.playheadTs + dtMs * this.rate
    if (this.skipGaps) {
      // Jump any manifest gap the playhead sits in or just crossed into.
      // Bounded loop: gaps are disjoint and sorted, so each iteration moves
      // strictly forward.
      for (let i = 0; i < this.timeline.gaps.length; i++) {
        const gap = gapAt(this.timeline, next)
        if (!gap) break
        this.skipCounter++
        this.lastSkip = { fromTs: gap.fromTs, toTs: gap.toTs, seq: this.skipCounter }
        next = gap.toTs
        this.seekSeq++
      }
    }
    this.playheadTs = clampTs(this.timeline, next)
    this.endCheck()
    this.notify()
  }

  private endCheck(): void {
    if (this.playheadTs >= this.timeline.to) {
      this.playheadTs = this.timeline.to
      this.playing = false
    }
  }
}
