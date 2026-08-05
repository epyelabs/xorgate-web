import { useEffect, useMemo, useState } from "react"
import { resolveLiveBlock, type LiveBlockState } from "@/lib/live-block"
import type { UseIotTelemetry } from "@/hooks/use-iot-telemetry"

/**
 * Re-evaluate the block once a second.
 *
 * This exists for one case that no telemetry event can cover: the DEVICE goes
 * quiet while our broker connection stays up. Nothing arrives, so nothing
 * re-renders, so a purely event-driven gate would latch on the last verdict
 * forever — a device that dies mid-block would leave the operator staring at
 * "too hot" with no path back to the player. The tick ages that verdict out
 * (LIVE_BLOCK_STALE_MS) and doubles as the clock for the "Paused for 2m" label.
 */
const TICK_MS = 1000

/**
 * The live-stream block verdict for a device, ready to hand to `LiveVideoGrid`.
 *
 * All the judgement lives in `resolveLiveBlock` (pure, exhaustively tested);
 * this hook only supplies the two things a pure function cannot have — the
 * current time, and a reason to re-render when time is the only thing that
 * changed.
 */
export function useLiveBlock(
  feed: Pick<UseIotTelemetry, "status" | "recording" | "receivedAt">
): LiveBlockState {
  const { status, recording, receivedAt } = feed
  const [now, setNow] = useState(() => Date.now())

  // Only tick while a tick can change the answer: a connected feed with a
  // payload in hand is the only state where time alone matters (it can go
  // stale, and its elapsed label advances). Every other state already resolves
  // to a constant fail-open verdict, so ticking there would just re-render a
  // dead page once a second.
  const ticking = status === "connected" && receivedAt !== null
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [ticking])

  return useMemo(
    () => resolveLiveBlock({ status, recording, receivedAt, now }),
    [status, recording, receivedAt, now]
  )
}
