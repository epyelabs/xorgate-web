// TEMPORARY Phase 3 verification harness — mounts the production replay
// modules against a spike-dumped manifest (?m=<url>). Exposes window hooks
// for the Playwright driver. Delete with the .replay-harness directory.
import { StrictMode, useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import type { ReplaySegment, ReplaySession } from "@/lib/api"
import { buildTimeline, type ReplayTimeline } from "@/lib/replay/timeline"
import type { ReplayClock } from "@/lib/replay/replay-clock"
import { useReplayClock, useReplayClockState } from "@/hooks/use-replay-clock"
import { ReplayVideoTile } from "@/components/replay/replay-video-tile"
import { ReplayTimelineBar } from "@/components/replay/replay-timeline"

declare global {
  interface Window {
    __clock: ReplayClock | null
    __timeline: ReplayTimeline | null
    __ready: boolean
  }
}
window.__clock = null
window.__timeline = null
window.__ready = false

interface SpikeManifest {
  session: { streamKey?: string; status?: string; timeSource?: string | null }
  segments: Array<{
    seq: number
    startTsMs: number
    effectiveDurationMs: number
    durationMs: number
    finalized: boolean
    anchor: string | null
    sizeBytes: number | null
    url: string
  }>
  gaps: Array<{ fromTs: number; toTs: number; reason: string }>
}

// Spike-manifest → manifest-v1 session shape (the real page consumes the
// deployed endpoint; the harness reuses the spike's aws-presign dumper).
function toSession(m: SpikeManifest): {
  session: Pick<ReplaySession, "segments" | "gaps">
  from: number
  to: number
} {
  const segments: ReplaySegment[] = m.segments.map((s) => ({
    seq: s.seq,
    startTs: s.startTsMs,
    effectiveDurationMs: s.effectiveDurationMs ?? s.durationMs,
    finalized: s.finalized,
    anchor: (s.anchor ?? null) as ReplaySegment["anchor"],
    sizeBytes: s.sizeBytes,
    url: s.url,
  }))
  const last = segments[segments.length - 1]
  return {
    session: {
      segments,
      gaps: m.gaps.map((g) => ({
        fromTs: g.fromTs,
        toTs: g.toTs,
        reason: g.reason as "missing-segments" | "evicted-head",
      })),
    },
    from: segments[0].startTs,
    to: last.startTs + last.effectiveDurationMs,
  }
}

function Harness() {
  const [manifest, setManifest] = useState<SpikeManifest | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const src = new URLSearchParams(location.search).get("m")
    if (!src) {
      setError("missing ?m=<manifest url>")
      return
    }
    fetch(src)
      .then((r) => r.json())
      .then(setManifest)
      .catch((e) => setError(String(e)))
  }, [])

  const shaped = useMemo(() => (manifest ? toSession(manifest) : null), [manifest])
  const timeline = useMemo(
    () =>
      shaped ? buildTimeline(shaped.session, shaped.from, shaped.to) : null,
    [shaped]
  )
  const clock = useReplayClock(timeline)
  const state = useReplayClockState(clock)

  useEffect(() => {
    window.__clock = clock
    window.__timeline = timeline
    window.__ready = clock !== null
  }, [clock, timeline])

  if (error) return <p>error: {error}</p>
  if (!timeline || !clock) return <p>loading…</p>

  return (
    <div>
      <ReplayVideoTile
        clock={clock}
        label="harness"
        getSegmentUrl={(seg) => seg.url}
      />
      <ReplayTimelineBar clock={clock} timeline={timeline} />
      <pre id="state">{JSON.stringify(state, null, 1)}</pre>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>
)
