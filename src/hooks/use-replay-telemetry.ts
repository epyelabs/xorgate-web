import { useEffect, useMemo, useRef, useState } from "react"
import { ApiError, getTelemetry } from "@/lib/api"
import { getTelemetryResponseSchema } from "@/lib/schemas"
import type { LatestReading } from "@xorgate/sdk"
import { useReplayClockState } from "@/hooks/use-replay-clock"
import type { ReplayClock } from "@/lib/replay/replay-clock"
import type { ReplayTimeline } from "@/lib/replay/timeline"
import {
  buildTrace,
  chooseIntervalSeconds,
  latestWithin,
  metricGroup,
  overviewStalenessMs,
  positionAt,
  seriesFromReadings,
  stalenessMs,
  traceLines,
  traveledLines,
  windowBoundsFor,
  windowNeedsRefetch,
  DEFAULT_STALENESS_MS,
  GROUP_STALENESS_MS,
  WINDOW_MIN_SPAN_MS,
  WINDOW_SPAN_MS,
  type GpsTrace,
  type MetricSeries,
  type WindowBounds,
} from "@/lib/replay/replay-telemetry"
import type { IoCapabilities } from "@/lib/api"
import {
  gpsMetrics,
  imuMetrics,
  signalMetrics,
  systemMetrics,
} from "@/lib/capability-metrics"

// Replay telemetry source (composite replays plan, Phase 4 / R4): produces the
// SAME props the live useIotTelemetry hook feeds the views — latest-at-playhead
// per metric plus the map derivations — from recorded telemetry, synced to the
// replay clock. Two tiers:
//  - overview: one session-wide downsampled fetch per group (drives the full
//    route trace + instant scrub-preview readouts anywhere on the timeline)
//  - window: raw rows around the playhead, refetched with hysteresis (drives
//    readout/IMU/marker fidelity at native cadence near the playhead)
// Derivations run at the clock's throttled ~10 Hz snapshot rate and are all
// O(log n) binary searches over memoized sorted series (README perf gotcha).

// Overview bucket targets: fine for GPS (the trace is drawn from it), coarse
// for the rest (scrub preview only — the window tier supplies fidelity).
const OVERVIEW_GPS_TARGET_BUCKETS = 2_000
const OVERVIEW_DEFAULT_TARGET_BUCKETS = 500
// Pre-roll so a floor sample exists right at the replay start even for the
// slowest group (lte's ~15–20 s effective cadence).
const OVERVIEW_PREROLL_MS = 60_000
// Break the route polyline when consecutive fixes are further apart than this
// (scaled up for coarse buckets) — a GPS hole must show as a hole, not a chord.
const TRACE_BREAK_MS = 10_000
// Marker interpolation only bridges near-adjacent fixes (~a few missed 1 Hz
// periods); anything wider holds, then hides via staleness.
const MARKER_INTERP_MS = 3_000
// Back off failed window fetches briefly so an outage doesn't hammer the API
// at snapshot rate.
const WINDOW_ERROR_BACKOFF_MS = 5_000

interface MetricGroupSpec {
  key: string
  metrics: string[]
}

// Capability-driven metric groups — the same helpers/order the live views use.
// Each group is one API call (well under the 20-metric cap) and one staleness
// domain.
function buildGroups(caps: IoCapabilities | null): MetricGroupSpec[] {
  return [
    { key: "gps", metrics: gpsMetrics(caps) },
    { key: "imu", metrics: imuMetrics(caps) },
    { key: "lte", metrics: signalMetrics(caps) },
    { key: "system", metrics: systemMetrics(caps) },
  ].filter((g) => g.metrics.length > 0)
}

interface GroupWindow {
  bounds: WindowBounds | null
  spanMs: number
  series: Map<string, MetricSeries>
  fetching: boolean
  lastErrorAt: number
}

export interface UseReplayTelemetry {
  latest: Record<string, LatestReading>
  position: [number, number] | null
  course: number | null
  // Full recorded route (dim underlay) and the traveled portion (highlight),
  // as polylines split at recording holes. [lon, lat] Mapbox order.
  routeLines: [number, number][][]
  traveledLines: [number, number][][]
  // Whether the session recorded any GPS at all — drives the map empty-state
  // copy ("No GPS recorded" vs a momentary hole).
  hasGps: boolean
  // Overview tier in flight (first paint of trace + readouts pending).
  loading: boolean
  error: string | null
}

export interface UseReplayTelemetryOptions {
  // DI seam for the auth-less test harness; defaults to the real API client.
  fetchTelemetry?: typeof getTelemetry
}

export function useReplayTelemetry(
  deviceId: string,
  timeline: ReplayTimeline | null,
  clock: ReplayClock | null,
  caps: IoCapabilities | null,
  options?: UseReplayTelemetryOptions
): UseReplayTelemetry {
  const fetchRef = useRef(options?.fetchTelemetry ?? getTelemetry)
  fetchRef.current = options?.fetchTelemetry ?? getTelemetry

  const snap = useReplayClockState(clock)
  const playheadTs = snap?.playheadTs ?? timeline?.from ?? 0

  const groups = useMemo(() => buildGroups(caps), [caps])
  const groupsKey = groups.map((g) => g.metrics.join(",")).join(";")

  // --- overview tier (once per replay) ---
  const [overview, setOverview] = useState<{
    series: Map<string, MetricSeries>
    loading: boolean
    error: string | null
  }>({ series: new Map(), loading: false, error: null })

  useEffect(() => {
    if (!deviceId || !timeline || groups.length === 0) return
    let cancelled = false
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setOverview({ series: new Map(), loading: true, error: null })
    const spanMs = timeline.to - timeline.from
    ;(async () => {
      try {
        const fromIso = new Date(timeline.from - OVERVIEW_PREROLL_MS).toISOString()
        const toIso = new Date(timeline.to + 2_000).toISOString()
        const parts = await Promise.all(
          groups.map(async (g) => {
            const interval = chooseIntervalSeconds(
              spanMs + OVERVIEW_PREROLL_MS,
              g.metrics.length,
              g.key === "gps"
                ? OVERVIEW_GPS_TARGET_BUCKETS
                : OVERVIEW_DEFAULT_TARGET_BUCKETS
            )
            const raw = await fetchRef.current(deviceId, {
              from: fromIso,
              to: toIso,
              metric: g.metrics.join(","),
              interval,
            })
            const parsed = getTelemetryResponseSchema.safeParse(raw)
            if (!parsed.success) {
              throw new Error("Unexpected /telemetry response shape")
            }
            return seriesFromReadings(
              parsed.data.readings,
              parsed.data.bucketSeconds ?? interval
            )
          })
        )
        if (cancelled) return
        const series = new Map<string, MetricSeries>()
        for (const part of parts) {
          for (const [metric, s] of part) series.set(metric, s)
        }
        setOverview({ series, loading: false, error: null })
      } catch (err) {
        if (cancelled) return
        const message =
          err instanceof ApiError ? err.message : (err as Error).message
        setOverview({ series: new Map(), loading: false, error: message })
      }
    })()
    return () => {
      cancelled = true
    }
    // groupsKey stands in for the groups array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, timeline, groupsKey])

  // --- high-res window tier (hysteresis around the playhead) ---
  const windowsRef = useRef(new Map<string, GroupWindow>())
  const generationRef = useRef(0)
  const [windowVersion, setWindowVersion] = useState(0)

  // New replay (or metric set) → drop all windows and invalidate in-flight
  // fetches from the previous one.
  useEffect(() => {
    generationRef.current++
    windowsRef.current = new Map()
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setWindowVersion((v) => v + 1)
  }, [deviceId, timeline, groupsKey])

  useEffect(() => {
    if (!deviceId || !timeline || groups.length === 0) return
    const generation = generationRef.current
    const now = performance.now()
    for (const g of groups) {
      let win = windowsRef.current.get(g.key)
      if (!win) {
        win = {
          bounds: null,
          spanMs: WINDOW_SPAN_MS,
          series: new Map(),
          fetching: false,
          lastErrorAt: 0,
        }
        windowsRef.current.set(g.key, win)
      }
      if (win.fetching) continue
      if (now - win.lastErrorAt < WINDOW_ERROR_BACKOFF_MS && win.lastErrorAt > 0)
        continue
      if (
        !windowNeedsRefetch(
          win.bounds,
          playheadTs,
          win.spanMs,
          timeline.from,
          timeline.to
        )
      )
        continue

      win.fetching = true
      const target = win
      const preRollMs = GROUP_STALENESS_MS[g.key] ?? DEFAULT_STALENESS_MS
      void (async () => {
        try {
          let spanMs = target.spanMs
          for (;;) {
            const bounds = windowBoundsFor(
              playheadTs,
              spanMs,
              timeline.from,
              timeline.to
            )
            const raw = await fetchRef.current(deviceId, {
              from: new Date(bounds.fromTs - preRollMs).toISOString(),
              to: new Date(bounds.toTs).toISOString(),
              metric: g.metrics.join(","),
            })
            if (generationRef.current !== generation) return
            const parsed = getTelemetryResponseSchema.safeParse(raw)
            if (!parsed.success) {
              throw new Error("Unexpected /telemetry response shape")
            }
            // Truncated = the raw cap cut the tail off. Adapt: halve the span
            // and refetch (sticky, so future windows start at the fitting
            // size). At the floor, keep the rows but only claim coverage up
            // to the last row actually returned.
            if (parsed.data.truncated && spanMs > WINDOW_MIN_SPAN_MS) {
              spanMs = Math.max(WINDOW_MIN_SPAN_MS, spanMs / 2)
              target.spanMs = spanMs
              continue
            }
            const series = seriesFromReadings(parsed.data.readings, null)
            let toTs = bounds.toTs
            if (parsed.data.truncated) {
              let lastTs = bounds.fromTs
              for (const s of series.values()) {
                const t = s.ts[s.ts.length - 1]
                if (t > lastTs) lastTs = t
              }
              toTs = lastTs
            }
            target.bounds = { fromTs: bounds.fromTs, toTs }
            target.series = series
            target.fetching = false
            setWindowVersion((v) => v + 1)
            return
          }
        } catch {
          if (generationRef.current !== generation) return
          target.fetching = false
          target.lastErrorAt = performance.now()
        }
      })()
    }
    // playheadTs (≤10 Hz) is the scheduler tick; windowVersion re-runs the
    // check after every fetch completion — a seek during an in-flight fetch
    // would otherwise land a window centered on the OLD playhead with nothing
    // to correct it until the next clock notify (never, while paused).
    // groupsKey stands in for groups.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, timeline, groupsKey, playheadTs, windowVersion])

  // --- derivations (all O(log n), at the ≤10 Hz snapshot rate) ---

  // Nearest sample ≤ playhead: the raw window is the truth while the playhead
  // is inside its bounds (absent there = a real recording hole); elsewhere the
  // bucketed overview answers with a widened cutoff (instant scrub preview,
  // refined when the window catches up).
  const resolve = useMemo(() => {
    void windowVersion
    const windows = windowsRef.current
    const overviewSeries = overview.series
    return (metric: string, ts: number): LatestReading | null => {
      const win = windows.get(metricGroup(metric))
      if (win?.bounds && ts >= win.bounds.fromTs && ts <= win.bounds.toTs) {
        const s = win.series.get(metric)
        return s ? latestWithin(s, metric, ts, stalenessMs(metric)) : null
      }
      const s = overviewSeries.get(metric)
      if (!s) return null
      return latestWithin(
        s,
        metric,
        ts,
        overviewStalenessMs(metric, s.bucketMs ?? 0)
      )
    }
  }, [overview.series, windowVersion])

  const latest = useMemo(() => {
    const out: Record<string, LatestReading> = {}
    for (const g of groups) {
      for (const metric of g.metrics) {
        const r = resolve(metric, playheadTs)
        if (r) out[metric] = r
      }
    }
    return out
    // groupsKey stands in for the groups array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolve, playheadTs, groupsKey])

  // Route + traveled highlight come from the overview trace (session-wide);
  // the window trace only refines the marker near the playhead.
  const overviewTrace = useMemo(() => {
    const lat = overview.series.get("gps.lat")
    const breakMs = Math.max(TRACE_BREAK_MS, 3 * (lat?.bucketMs ?? 0))
    return buildTrace(lat, overview.series.get("gps.lon"), breakMs)
  }, [overview.series])

  const routeLines = useMemo(() => traceLines(overviewTrace), [overviewTrace])

  const windowTrace: GpsTrace | null = useMemo(() => {
    void windowVersion
    const win = windowsRef.current.get("gps")
    if (!win?.bounds) return null
    return buildTrace(
      win.series.get("gps.lat"),
      win.series.get("gps.lon"),
      TRACE_BREAK_MS
    )
  }, [windowVersion])

  const marker = useMemo(() => {
    const win = windowsRef.current.get("gps")
    if (
      windowTrace &&
      win?.bounds &&
      playheadTs >= win.bounds.fromTs &&
      playheadTs <= win.bounds.toTs
    ) {
      return positionAt(
        windowTrace,
        playheadTs,
        MARKER_INTERP_MS,
        GROUP_STALENESS_MS.gps
      )
    }
    const bucketMs = overview.series.get("gps.lat")?.bucketMs ?? 0
    return positionAt(
      overviewTrace,
      playheadTs,
      Math.max(MARKER_INTERP_MS, 2 * bucketMs),
      overviewStalenessMs("gps.lat", bucketMs)
    )
  }, [windowTrace, overviewTrace, playheadTs, overview.series])

  const traveled = useMemo(
    () => traveledLines(overviewTrace, playheadTs, marker?.pos ?? null),
    [overviewTrace, playheadTs, marker]
  )

  const courseReading = latest["gps.course"]

  return {
    latest,
    position: marker?.pos ?? null,
    course: typeof courseReading?.value === "number" ? courseReading.value : null,
    routeLines,
    traveledLines: traveled,
    hasGps: overviewTrace.pts.length > 0,
    loading: overview.loading,
    error: overview.error,
  }
}
