import type { ApiRecordingRun, MediaSession } from "@/lib/api"

// Recording runs (composite replays plan, R9): one drive with N cameras
// produces N per-cam sessions; the sessions table's primary object is the
// RUN — sessions clustered by time overlap. There is NO device-side runId
// and no schema change.
//
// ⚠️ Clustering now happens SERVER-side (improve-recording-history-fetching,
// Phase 3): `GET /devices/{id}/sessions?group=runs` clusters over the device's
// whole session set and paginates runs, which is what removed the uneven pages
// and the runs that rendered twice at a page boundary. Use `runFromApi` to turn
// a response run into the `RecordingRun` the helpers below consume.

// A session that starts within this of another's end joins the same run —
// covers capture restarts and per-cam pipeline start staggers. The device
// rotates segments every ~60 s, so a genuinely separate recording is
// minutes away in practice.
// ⚠️ Mirrored by `RUN_GAP_TOLERANCE_MS` in
// `backend/src/services/session-runs.ts`, which is now the value that actually
// decides run boundaries. The two must agree.
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

// Adapt a `?group=runs` response row to the `RecordingRun` shape the replay
// helpers below read. The API speaks ISO (the sessions dialect); replay works
// in epoch ms (the replay-clock unit), so the conversion happens here, once.
export function runFromApi(run: ApiRecordingRun): RecordingRun {
  return {
    key: run.key,
    sessions: run.sessions,
    fromMs: Date.parse(run.fromTs),
    toMs: Date.parse(run.toTs),
    streamKeys: run.streamKeys,
    segmentCount: run.segmentCount,
    totalBytes: run.totalBytes,
    anyOpen: run.anyOpen,
    anyUnsynced: run.anyUnsynced,
  }
}

// Cluster a page of sessions into runs, newest-first (table order). Input
// order does not matter; overlap is evaluated on the time axis.
//
// ⚠️ No screen calls this any more — the server clusters (Phase 3). It is kept
// as the executable reference specification of what a run IS: the backend's
// `src/services/session-runs.ts` mirrors this algorithm, its window-function
// equivalence proof is stated against it, and `test/session-runs.test.ts` +
// `test/session-runs.live.test.ts` are ports of the cases in `runs.test.ts`
// below. If you change the tolerance or the open-session end estimate here,
// change them there too — or delete both.
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
