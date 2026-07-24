import { useEffect, useRef, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { formatDuration } from "@/components/data-table"
import type { ReplaySegment } from "@/lib/api"
import type { ReplayClock } from "@/lib/replay/replay-clock"
import { parseSegmentMediaInfo } from "@/lib/replay/mp4-box"
import {
  hasCoverageAt,
  nextSegmentAfter,
  segmentAt,
  segmentEnd,
  type ReplayTimeline,
} from "@/lib/replay/timeline"

// How far behind the playhead we keep buffered media when Chrome's quota
// forces an eviction (spike recipe: ~120 s keeps small back-scrubs warm).
const EVICT_KEEP_BEHIND_S = 120
// Micro-gap jump ceiling: buffered holes at rotation seams are ≤ ~2 s (fstat
// anchors); anything a jump can't reach within this is the clock's business.
const MICRO_GAP_MAX_S = 5
// A paused playhead sitting this close before the lane's next segment is not
// "no video" — in composite the replay window starts at the EARLIEST camera,
// so the other lanes begin a few ms later (and sub-2 s seam holes are never
// manifest gaps either). Show the loading/poster state instead of the gap
// overlay.
const NEAR_COVERAGE_MS = 2_500
const FETCH_RETRY_MS = 4000
const SKIP_NOTICE_MS = 3000

type TileStatus = "loading" | "ready" | "error"

interface AppendTask {
  seq: number
  data: ArrayBuffer
  offsetSec: number
  partial: boolean
  attempts: number
}

// Imperative MSE side of the tile (Phase 1 spike recipe, verbatim):
// one SourceBuffer, duration pinned to the replay span, per-segment
// timestampOffset from parsed tfdt, quota-evict + retry, buffered-as-truth.
class MseEngine {
  private readonly video: HTMLVideoElement
  private readonly timeline: ReplayTimeline
  private readonly getUrl: (seg: ReplaySegment) => string
  private readonly onError: (message: string) => void
  private readonly onUpdate: () => void
  private readonly onAuthError: (() => void) | undefined

  private ms: MediaSource | null = null
  private sb: SourceBuffer | null = null
  private objectUrl: string | null = null
  private initStarted = false
  private destroyed = false
  private pendingOp: "append" | "remove" | null = null
  private readonly queue: AppendTask[] = []
  // Keyed by segment startTs, not seq: a composite lane merges same-streamKey
  // sessions, and seq restarts at 0 in each (startTs is unique within a lane).
  private readonly fetching = new Set<number>()
  private readonly lastAttempt = new Map<number, number>()
  private readonly abort = new AbortController()

  constructor(opts: {
    video: HTMLVideoElement
    timeline: ReplayTimeline
    getUrl: (seg: ReplaySegment) => string
    onError: (message: string) => void
    onUpdate: () => void
    onAuthError?: () => void
  }) {
    this.video = opts.video
    this.timeline = opts.timeline
    this.getUrl = opts.getUrl
    this.onError = opts.onError
    this.onUpdate = opts.onUpdate
    this.onAuthError = opts.onAuthError
  }

  destroy(): void {
    this.destroyed = true
    this.abort.abort()
    this.queue.length = 0
    try {
      if (this.ms && this.ms.readyState === "open") this.ms.endOfStream()
    } catch {
      /* already closed */
    }
    this.video.removeAttribute("src")
    this.video.load()
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
  }

  private segPos(seg: ReplaySegment): number {
    return (seg.startTs - this.timeline.from) / 1000
  }

  // Buffered-as-truth (spike recipe item 5): WebKit silently auto-evicts, so
  // an appended-seq set alone would lie — always consult video.buffered.
  isBufferedAt(posSec: number): boolean {
    const { buffered } = this.video
    for (let i = 0; i < buffered.length; i++) {
      if (posSec >= buffered.start(i) - 0.1 && posSec < buffered.end(i)) {
        return true
      }
    }
    return false
  }

  // Make sure the segment covering ts (if any) and the next one are fetched/
  // buffered. Called at clock-notify rate — every path below is guarded so
  // steady state does no work.
  ensureAt(ts: number): void {
    if (this.destroyed) return
    const hit = segmentAt(this.timeline, ts)
    if (hit) {
      // Probe a little ahead of the playhead, clamped inside the segment so
      // the exclusive tail doesn't trigger eternal refetches.
      const probe = Math.min(
        (ts - this.timeline.from) / 1000 + 0.3,
        this.segPos(hit.segment) + hit.segment.effectiveDurationMs / 1000 - 0.5
      )
      if (!this.isBufferedAt(Math.max(probe, this.segPos(hit.segment)))) {
        this.fetchSegment(hit.segment)
      }
    }
    // Prefetch one segment ahead (spike: 1-segment lookahead never starved at
    // 1× or 4×; also makes gap exits and seeks feel instant).
    const next = nextSegmentAfter(this.timeline, hit ? segmentEnd(hit.segment) : ts)
    if (next && !this.isBufferedAt(this.segPos(next) + 0.5)) {
      this.fetchSegment(next)
    }
  }

  private fetchSegment(seg: ReplaySegment): void {
    if (this.fetching.has(seg.startTs)) return
    const last = this.lastAttempt.get(seg.startTs)
    if (last !== undefined && performance.now() - last < FETCH_RETRY_MS) return
    this.lastAttempt.set(seg.startTs, performance.now())
    this.fetching.add(seg.startTs)
    void (async () => {
      try {
        const res = await fetch(this.getUrl(seg), { signal: this.abort.signal })
        if (!res.ok) {
          // Presigned URL expired/revoked: tell the page so it can refetch
          // the manifest early (the backoff retry then uses the fresh URL).
          if (res.status === 403) this.onAuthError?.()
          throw new Error(`segment ${seg.seq}: HTTP ${res.status}`)
        }
        const data = await res.arrayBuffer()
        if (this.destroyed) return
        const info = parseSegmentMediaInfo(data)
        if (!this.initStarted) this.initMse(info.codec)
        this.queue.push({
          seq: seg.seq,
          data,
          // Every segment's internal timeline restarts at ~0; the offset is
          // effectively segPos, but subtracting the parsed tfdt guards
          // against future muxer changes (spike recipe item 3).
          offsetSec: this.segPos(seg) - info.firstTfdtSec,
          partial: !seg.finalized,
          attempts: 0,
        })
        this.processQueue()
      } catch (err) {
        if (this.destroyed || (err as Error).name === "AbortError") return
        // Transient (expired URL just before a manifest refresh, network
        // blip): ensureAt retries after the backoff window.
        console.warn("replay segment fetch failed", err)
      } finally {
        this.fetching.delete(seg.startTs)
      }
    })()
  }

  private initMse(codec: string | null): void {
    this.initStarted = true
    const type = `video/mp4; codecs="${codec ?? "avc1.42C028"}"`
    if (!("MediaSource" in window) || !MediaSource.isTypeSupported(type)) {
      this.onError(
        `This browser cannot play the recorded video (${type} unsupported).`
      )
      return
    }
    const ms = new MediaSource()
    this.ms = ms
    ms.addEventListener("sourceopen", () => {
      if (this.destroyed || this.sb) return
      const sb = ms.addSourceBuffer(type)
      sb.mode = "segments"
      // Pin duration to the replay span BEFORE any append: without this,
      // seeks beyond appended data clamp and hang (spike recipe item 2).
      ms.duration = (this.timeline.to - this.timeline.from) / 1000
      sb.addEventListener("updateend", () => this.onUpdateEnd())
      sb.addEventListener("error", () => {
        this.onError("Video buffer error — try reloading the page.")
      })
      this.sb = sb
      this.processQueue()
    })
    this.objectUrl = URL.createObjectURL(ms)
    this.video.src = this.objectUrl
  }

  private onUpdateEnd(): void {
    if (this.destroyed) return
    const op = this.pendingOp
    this.pendingOp = null
    if (op === "append") {
      const task = this.queue.shift()
      // Crash-cut file appended: reset the box parser before the next append
      // (spike recipe item 6).
      if (task?.partial && this.sb && !this.sb.updating) {
        try {
          this.sb.abort()
        } catch {
          /* parser reset is best-effort */
        }
      }
      this.onUpdate()
    }
    this.processQueue()
  }

  private processQueue(): void {
    const sb = this.sb
    if (!sb || sb.updating || this.pendingOp || this.queue.length === 0) return
    const task = this.queue[0]
    try {
      sb.timestampOffset = task.offsetSec
      this.pendingOp = "append"
      sb.appendBuffer(task.data)
    } catch (err) {
      this.pendingOp = null
      if ((err as Error).name === "QuotaExceededError" && task.attempts < 3) {
        // Spike recipe item 5: drop far-behind media, then retry the append
        // (recovered 6/6 in the Chrome soak; WebKit never throws).
        task.attempts++
        const playheadPos = this.video.currentTime
        const evictEnd = Math.max(playheadPos - EVICT_KEEP_BEHIND_S, 1)
        try {
          this.pendingOp = "remove"
          sb.remove(0, evictEnd)
        } catch {
          this.pendingOp = null
          this.queue.shift()
          this.onError("Video buffer full and eviction failed.")
        }
      } else {
        this.queue.shift()
        console.warn("replay append failed", err)
        this.processQueue()
      }
    }
  }
}

/**
 * Replay video tile: plays one LANE's recorded segments as a continuous
 * timeline via MSE (Phase 1 verdict), strictly as a follower/pacer-candidate
 * of the replay clock. The clock elects one lane with coverage as pacer (its
 * element drives the playhead); the other lanes chase the clock and re-seek
 * when drift exceeds ~150 ms. When THIS lane has no video at the playhead
 * the tile pauses and shows its no-video state — independently of the other
 * lanes (see lib/replay/replay-clock.ts and lib/replay/lanes.ts).
 */
export function ReplayVideoTile({
  clock,
  timeline,
  label,
  getSegmentUrl,
  onAuthError,
}: {
  clock: ReplayClock
  // This lane's timeline. Single-session replay passes the clock's own
  // timeline; composite passes the per-streamKey lane timeline. Must share
  // the clock timeline's from/to (lanes.ts guarantees it).
  timeline: ReplayTimeline
  // Unique per page — doubles as the pacer-election id.
  label: string
  // URL resolution is indirect so manifest TTL refreshes swap presigned URLs
  // without rebuilding the timeline (or resetting the clock).
  getSegmentUrl: (seg: ReplaySegment) => string
  // Segment fetch got a 403 (URL expired despite the scheduled refresh) —
  // the page refetches the manifest and swaps URLs.
  onAuthError?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<TileStatus>("loading")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [inGap, setInGap] = useState(false)
  const [skipNotice, setSkipNotice] = useState<string | null>(null)

  const getUrlRef = useRef(getSegmentUrl)
  useEffect(() => {
    getUrlRef.current = getSegmentUrl
  }, [getSegmentUrl])
  const onAuthErrorRef = useRef(onAuthError)
  useEffect(() => {
    onAuthErrorRef.current = onAuthError
  }, [onAuthError])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let firstFrameSeen = false
    const engine = new MseEngine({
      video,
      timeline,
      getUrl: (seg) => getUrlRef.current(seg),
      onError: (message) => {
        setErrorMsg(message)
        setStatus("error")
      },
      onUpdate: () => onClockChange(),
      onAuthError: () => onAuthErrorRef.current?.(),
    })

    let lastSeekSeq = -1
    let lastSkipSeq = 0
    let pendingAlign = true
    let skipTimer: ReturnType<typeof setTimeout> | null = null

    const onClockChange = () => {
      const st = clock.getState()
      const cover = segmentAt(timeline, st.playheadTs)
      const pos = (st.playheadTs - timeline.from) / 1000

      if (st.lastSkip && st.lastSkip.seq !== lastSkipSeq) {
        lastSkipSeq = st.lastSkip.seq
        setSkipNotice(
          `Skipped ${formatDuration(st.lastSkip.toTs - st.lastSkip.fromTs)} with no video`
        )
        if (skipTimer) clearTimeout(skipTimer)
        skipTimer = setTimeout(() => setSkipNotice(null), SKIP_NOTICE_MS)
      }

      if (!cover) {
        // Paused a hair before this lane's coverage (composite lanes start
        // milliseconds apart; the window anchors on the earliest camera):
        // "No video recorded" would be a lie — park the element on the
        // upcoming first frame as a poster instead. While playing, honest
        // gap state stands (any flash crossing a sliver lasts one notify).
        const next = nextSegmentAfter(timeline, st.playheadTs)
        if (
          !st.playing &&
          next !== null &&
          next.startTs - st.playheadTs <= NEAR_COVERAGE_MS
        ) {
          setInGap(false)
          const posterPos = (next.startTs - timeline.from) / 1000 + 0.05
          if (Math.abs(video.currentTime - posterPos) > 0.05) {
            video.currentTime = posterPos
          }
        } else {
          setInGap(true)
        }
        if (!video.paused) video.pause()
        // Keep the far side warm so resuming out of the gap is instant.
        engine.ensureAt(st.playheadTs)
        // Consume any seeks that happened while uncovered; re-entry realigns.
        lastSeekSeq = st.seekSeq
        pendingAlign = true
        return
      }
      setInGap(false)
      engine.ensureAt(st.playheadTs)

      // Elected pacer drives the clock; everyone else (paused tiles, follower
      // lanes) chases it and re-seeks past the drift ceiling.
      const pacing = st.playing && clock.pacerId() === label
      const drift = Math.abs(video.currentTime - pos)
      if (st.seekSeq !== lastSeekSeq || pendingAlign || (!pacing && drift > 0.15)) {
        lastSeekSeq = st.seekSeq
        pendingAlign = false
        if (drift > 0.05) video.currentTime = pos
      }
      if (video.playbackRate !== st.rate) video.playbackRate = st.rate
      if (st.playing && video.paused) {
        void video.play().catch(() => {
          /* interrupted by pause/seek — the next notify reconciles */
        })
      } else if (!st.playing && !video.paused) {
        video.pause()
      }
      // Established-stall probe (see recoverStall): a stalled pacer emits no
      // clock notifies, so this effectively runs at the 500 ms pump rate.
      if (pacing && !video.paused && video.readyState <= 2) {
        recoverStall()
      }
    }

    // The element paces the clock only while elected (lane coverage +
    // playing); registration is unconditional, the clock decides (pacing
    // contract). `covers` is the LANE's coverage — per-lane gap independence.
    const unregisterPacer = clock.registerPacer(label, {
      read: () => timeline.from + video.currentTime * 1000,
      covers: (ts) => hasCoverageAt(timeline, ts),
    })

    const unsubscribe = clock.subscribe(onClockChange)

    // Micro-gap jump controller (spike recipe item 4): the element stalls at
    // ANY buffered hole and never self-recovers. Sub-5 s holes get nudged
    // past; a stall with nothing ahead inside claimed coverage means a
    // crash-cut landed short — hand the playhead back to the clock at the
    // segment boundary (boundary-reached, not an error).
    const recoverStall = () => {
      const st = clock.getState()
      if (!st.playing) return
      // Followers never steer the clock or jump ahead of it: a follower
      // stalled in a local buffered hole recovers by chasing the clock once
      // the (pacer-driven) playhead moves past the hole.
      if (clock.pacerId() !== label) return
      const t = video.currentTime
      let nextStart: number | null = null
      for (let i = 0; i < video.buffered.length; i++) {
        const start = video.buffered.start(i)
        if (start > t + 0.05) {
          nextStart = start
          break
        }
      }
      if (nextStart !== null && nextStart - t < MICRO_GAP_MAX_S) {
        video.currentTime = nextStart + 0.05
        return
      }
      // Boundary-reached ONLY when this segment's media was really consumed:
      // some buffered range must end right at the stall point (media ran out
      // before the segment's claimed coverage — end of segment before a gap,
      // or a crash-cut landing short). A stall with nothing buffered here is
      // just a cold fetch in progress — wait, the pump retries. Note the far
      // side of a gap may already be prefetched, so "a range exists ahead"
      // says nothing — only the consumed-to-range-end test does.
      const cover = segmentAt(timeline, st.playheadTs)
      if (cover) {
        for (let i = 0; i < video.buffered.length; i++) {
          const end = video.buffered.end(i)
          if (end > t - 0.5 && end < t + 0.3) {
            clock.seek(segmentEnd(cover.segment))
            return
          }
        }
      }
    }
    // The `waiting` event only covers stalls that BEGIN while playing. A seek
    // that lands inside a seam hole while paused fires its `waiting` before
    // play() (ignored above), and no further event ever comes — so the pump
    // path below also probes for an established stall (readyState says the
    // element cannot advance) and runs the same recovery.
    const onWaiting = () => recoverStall()
    video.addEventListener("waiting", onWaiting)

    const onLoadedData = () => {
      if (!firstFrameSeen) {
        firstFrameSeen = true
        setStatus("ready")
      }
    }
    video.addEventListener("loadeddata", onLoadedData)

    // Kick off: fetch what the initial playhead needs and render its frame.
    onClockChange()
    // Safety pump: while paused (or while the pacer is stalled on a cold
    // fetch) the clock emits no notifies, so nothing would re-run ensureAt —
    // this retries failed/backed-off fetches and keeps prefetch warm.
    const pump = setInterval(onClockChange, 500)

    return () => {
      clearInterval(pump)
      unsubscribe()
      unregisterPacer()
      video.removeEventListener("waiting", onWaiting)
      video.removeEventListener("loadeddata", onLoadedData)
      if (skipTimer) clearTimeout(skipTimer)
      engine.destroy()
    }
    // getSegmentUrl/onAuthError intentionally via refs; clock + lane timeline
    // identity define a replay.
  }, [clock, timeline, label])

  return (
    <Card className="overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="relative aspect-video max-h-[40vh] w-full bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-contain"
          />
          {status === "loading" && !inGap ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-xs text-white/70">Loading video…</p>
            </div>
          ) : null}
          {status === "error" ? (
            <div className="absolute inset-0 flex items-center justify-center px-4">
              <p className="text-center text-xs text-destructive">{errorMsg}</p>
            </div>
          ) : null}
          {inGap && status !== "error" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/80">
              <p className="text-sm font-medium text-white/90">
                No video recorded
              </p>
              <p className="text-xs text-white/60">
                There is no footage for this part of the timeline.
              </p>
            </div>
          ) : null}
          {skipNotice ? (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-white/90">
              {skipNotice}
            </div>
          ) : null}
          <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
            {label}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
