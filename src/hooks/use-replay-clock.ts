import { useEffect, useRef, useState } from "react"
import { ReplayClock, type ReplayClockState } from "@/lib/replay/replay-clock"
import type { ReplayTimeline } from "@/lib/replay/timeline"

// React glue for the replay clock: one rAF driver per page (the clock itself
// is pure — see lib/replay/replay-clock.ts). The timeline is built once per
// replay load and must stay referentially stable; manifest TTL refetches swap
// segment URLs elsewhere without touching it, so the clock never resets
// mid-replay.
export function useReplayClock(
  timeline: ReplayTimeline | null
): ReplayClock | null {
  const [clock, setClock] = useState<ReplayClock | null>(null)

  useEffect(() => {
    if (!timeline) return
    const c = new ReplayClock(timeline)
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setClock(c)
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      // Clamp dt: rAF stops in background tabs, and an un-clamped catch-up
      // tick would free-run the playhead minutes ahead on return. (The video
      // pacer path is unaffected — if the video really kept playing, the
      // clock follows it.)
      const dt = Math.min(now - last, 250)
      last = now
      c.tick(dt)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      setClock(null)
    }
  }, [timeline])

  return clock
}

// Throttled snapshot for UI chrome (scrubber, readouts): the clock notifies
// at rAF rate, but ~10 Hz re-renders are plenty (README perf gotcha).
// Imperative followers (the video tile) subscribe directly instead.
export function useReplayClockState(
  clock: ReplayClock | null,
  throttleMs = 100
): ReplayClockState | null {
  const [state, setState] = useState<ReplayClockState | null>(null)
  const lastRender = useRef(0)
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!clock) return
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setState(clock.getState())
    const push = () => {
      lastRender.current = performance.now()
      setState(clock.getState())
    }
    const unsubscribe = clock.subscribe(() => {
      const since = performance.now() - lastRender.current
      if (since >= throttleMs) {
        if (trailing.current) {
          clearTimeout(trailing.current)
          trailing.current = null
        }
        push()
      } else if (!trailing.current) {
        // Trailing edge so the last event of a burst (e.g. pause, seek
        // release) always lands.
        trailing.current = setTimeout(() => {
          trailing.current = null
          push()
        }, throttleMs - since)
      }
    })
    return () => {
      unsubscribe()
      if (trailing.current) clearTimeout(trailing.current)
      setState(null)
    }
  }, [clock, throttleMs])

  return state
}
