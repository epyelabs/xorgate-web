import type { MediaSession } from "@/lib/api"

// Recording runs (composite replays plan, R9): one drive with N cameras
// produces N per-cam sessions; the sessions table's primary object is the
// RUN — sessions clustered by time overlap. There is NO device-side runId
// and no schema change: clustering is a pure client-side sweep over the
// fetched page (sessions from one drive sort adjacently by startedAt).
// If page-boundary splits prove annoying on real data, grouping moves
// server-side — decide on evidence (phase-5 doc).

// A session that starts within this of another's end joins the same run —
// covers capture restarts and per-cam pipeline start staggers. The device
// rotates segments every ~60 s, so a genuinely separate recording is
// minutes away in practice.
export const RUN_GAP_TOLERANCE_MS = 60_000

export interface RecordingRun {
  // Stable identity for React keys/expansion: the earliest session's id.
  key: string
  // Members ordered by startedAt (then streamKey for deterministic ties).
  sessions: MediaSession[]
  fromMs: number
  toMs: number
  streamKeys: string[]
  segmentCount: number
  totalBytes: number
  anyOpen: boolean
  anyUnsynced: boolean
}

function startMs(s: MediaSession): number {
  const t = Date.parse(s.startedAt)
  return Number.isNaN(t) ? 0 : t
}

// Interval end for clustering + the run's replay window. Open sessions have
// no endedAt yet: estimate from uploaded duration (an under-estimate while a
// backlog drains — consistent with the replay page's "reload to extend").
function endMs(s: MediaSession): number {
  const start = startMs(s)
  if (s.endedAt) {
    const ended = Date.parse(s.endedAt)
    if (!Number.isNaN(ended)) return Math.max(ended, start)
  }
  return start + Math.max(s.totalDurationMs ?? 0, 0)
}

// Cluster a page of sessions into runs, newest-first (table order). Input
// order does not matter; overlap is evaluated on the time axis.
export function clusterRuns(
  sessions: readonly MediaSession[],
  toleranceMs: number = RUN_GAP_TOLERANCE_MS
): RecordingRun[] {
  const sorted = [...sessions].sort(
    (a, b) => startMs(a) - startMs(b) || a.streamKey.localeCompare(b.streamKey)
  )
  const clusters: { sessions: MediaSession[]; fromMs: number; toMs: number }[] =
    []
  for (const s of sorted) {
    const last = clusters[clusters.length - 1]
    if (last && startMs(s) <= last.toMs + toleranceMs) {
      last.sessions.push(s)
      last.toMs = Math.max(last.toMs, endMs(s))
    } else {
      clusters.push({ sessions: [s], fromMs: startMs(s), toMs: endMs(s) })
    }
  }
  return clusters
    .map((c) => ({
      key: c.sessions[0].id,
      sessions: c.sessions,
      fromMs: c.fromMs,
      toMs: c.toMs,
      streamKeys: [...new Set(c.sessions.map((s) => s.streamKey))].sort(),
      segmentCount: c.sessions.reduce((n, s) => n + s.segmentCount, 0),
      totalBytes: c.sessions.reduce((n, s) => n + s.totalBytes, 0),
      anyOpen: c.sessions.some((s) => s.status === "open"),
      anyUnsynced: c.sessions.some((s) => s.timeSource === "unsynced"),
    }))
    .reverse()
}

// Search params for a run's composite replay link (`/devices/$id/replay`).
// ISO-8601 — the manifest endpoint's query dialect.
export function runReplaySearch(run: RecordingRun): { from: string; to: string } {
  return {
    from: new Date(run.fromMs).toISOString(),
    to: new Date(run.toMs).toISOString(),
  }
}

// Server-side manifest caps (device-sessions.ts handler constants) — used to
// disable a run's Replay button rather than let the request 400.
export const REPLAY_MAX_SESSIONS = 10
export const REPLAY_MAX_SEGMENTS = 600
export const REPLAY_MAX_RANGE_MS = 24 * 60 * 60 * 1000

// Why a run cannot be replayed (button title), or null when it can.
export function runReplayBlocked(run: RecordingRun): string | null {
  if (run.segmentCount === 0) return "No segments uploaded yet"
  if (run.toMs - run.fromMs > REPLAY_MAX_RANGE_MS)
    return "Run is longer than the 24 h replay limit"
  if (run.sessions.length > REPLAY_MAX_SESSIONS)
    return `Run spans ${run.sessions.length} sessions (replay limit ${REPLAY_MAX_SESSIONS})`
  if (run.segmentCount > REPLAY_MAX_SEGMENTS)
    return `Run spans ${run.segmentCount} segments (replay limit ${REPLAY_MAX_SEGMENTS})`
  return null
}
