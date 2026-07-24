// TEMPORARY Phase 3 verification harness — mounts the production replay
// modules against a spike-dumped manifest (?m=<url>). Exposes window hooks
// for the Playwright driver. Delete with the .replay-harness directory.
import { StrictMode, memo, useEffect, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import type { IoCapabilities, ReplaySegment, ReplaySession } from "@/lib/api"
import { buildTimeline, type ReplayTimeline } from "@/lib/replay/timeline"
import type { ReplayClock } from "@/lib/replay/replay-clock"
import { useReplayClock, useReplayClockState } from "@/hooks/use-replay-clock"
import {
  useReplayTelemetry,
  type UseReplayTelemetry,
} from "@/hooks/use-replay-telemetry"
import { ReplayVideoTile } from "@/components/replay/replay-video-tile"
import { ReplayTimelineBar } from "@/components/replay/replay-timeline"
import { StreamsView } from "@/components/streams-view/streams-view"
import {
  makeFetchTelemetry,
  type RawDump,
  type TelemetryCall,
} from "./telemetry-server"

declare global {
  interface Window {
    __clock: ReplayClock | null
    __timeline: ReplayTimeline | null
    __ready: boolean
    // Phase 4 telemetry probes
    __telemetry: UseReplayTelemetry | null
    __telemetryCalls: TelemetryCall[]
    __viewRenders: number
  }
}
window.__clock = null
window.__timeline = null
window.__ready = false
window.__telemetry = null
window.__telemetryCalls = []
window.__viewRenders = 0

// Capabilities matching the bench fodder's device model (gps.course and the
// post-power-monitor system fields are in caps but have no recorded rows —
// exercising the honest-absent path).
const HARNESS_CAPS: IoCapabilities = {
  system: {
    fields: ["cpu_usage", "ram_usage", "cpu_temp", "disk_usage", "rail_5v"],
  },
  comm: {
    signal: { fields: ["rssi", "quality"] },
    gps: {
      fields: [
        "lat",
        "lon",
        "alt",
        "speed",
        "course",
        "satellites",
        "fix_quality",
        "satellites_in_view",
        "hdop",
      ],
    },
  },
  sensors: {
    imu: {
      accel: ["x", "y", "z"],
      quaternion: ["r", "i", "j", "k"],
      euler: ["roll", "pitch", "yaw"],
    },
  },
} as IoCapabilities

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

// Phase 4: mounts the production StreamsView (card variant) fed by the real
// useReplayTelemetry hook through its DI seam, and counts its own renders —
// each render of this component IS one re-render of the telemetry pane tree,
// so the counter measures the clock-driven re-render rate. memo() isolates it
// from the Harness shell's own ~10 Hz state <pre> re-renders (the real replay
// page has no such parent subscriber above StreamsView).
const TelemetryPane = memo(function TelemetryPane({
  deviceId,
  timeline,
  clock,
  dump,
}: {
  deviceId: string
  timeline: ReplayTimeline
  clock: ReplayClock
  dump: RawDump
}) {
  const fetchTelemetry = useMemo(
    () => makeFetchTelemetry(dump, { log: window.__telemetryCalls }),
    [dump]
  )
  const telemetry = useReplayTelemetry(deviceId, timeline, clock, HARNESS_CAPS, {
    fetchTelemetry,
  })
  window.__telemetry = telemetry
  // Count committed renders (not render-phase invocations — StrictMode
  // double-invokes those in dev, which would double the measured rate).
  useEffect(() => {
    window.__viewRenders++
  })
  const followingRef = useRef(true)
  return (
    <div className="flex flex-col gap-4">
      <StreamsView
        viewType="card"
        caps={HARNESS_CAPS}
        latest={telemetry.latest}
        imuView={null}
        position={telemetry.position}
        track={[]}
        course={telemetry.course}
        following={followingRef.current}
        onFollowingChange={(f) => (followingRef.current = f)}
        replayTrace={{
          route: telemetry.routeLines,
          traveled: telemetry.traveledLines,
        }}
      />
    </div>
  )
})

function Harness() {
  const [manifest, setManifest] = useState<SpikeManifest | null>(null)
  const [dump, setDump] = useState<RawDump | null>(null)
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
    const t = new URLSearchParams(location.search).get("t")
    if (t) {
      fetch(t)
        .then((r) => r.json())
        .then(setDump)
        .catch((e) => setError(String(e)))
    }
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
      {dump ? (
        <TelemetryPane
          deviceId="harness-device"
          timeline={timeline}
          clock={clock}
          dump={dump}
        />
      ) : null}
      <pre id="state">{JSON.stringify(state, null, 1)}</pre>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>
)
