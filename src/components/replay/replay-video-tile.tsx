import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { formatDuration } from "@/components/data-table"
import {
  ReplayVideo,
  type GapSkipEvent,
  type UseReplayPlayer,
} from "@xorgate/react"
import { xgMessage } from "@/lib/xorgate"

// How long the "skipped gap" pill stays up after the clock jumps a gap.
const SKIP_NOTICE_MS = 3000

/**
 * One replay lane's tile: page chrome (card, overlays, label) around the
 * package's ReplayVideo, which owns the whole MSE engine — fetching, append
 * queue, quota eviction, pacing, gap-jumping and URL-expiry recovery all live
 * in @xorgate/react now (extracted from the MseEngine this file used to
 * carry). The tile only renders what the lane state says.
 */
export function ReplayVideoTile({
  player,
  streamKey,
  label,
}: {
  player: UseReplayPlayer
  streamKey: string
  label: string
}) {
  const lane = player.laneState(streamKey)

  // Transient "Skipped 45s with no video" pill, driven by the clock's gap-skip
  // events (seq disambiguates two identical skips in a row).
  const [notice, setNotice] = useState<GapSkipEvent | null>(null)
  const skip = player.lastSkip
  useEffect(() => {
    if (!skip) return
    setNotice(skip)
    const timer = setTimeout(() => setNotice(null), SKIP_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [skip])

  return (
    <Card className="overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="relative aspect-video max-h-[40vh] w-full bg-black">
          <ReplayVideo
            player={player}
            streamKey={streamKey}
            className="h-full w-full object-contain"
          />
          {lane.status === "loading" && !lane.inGap ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-xs text-white/70">Loading video…</p>
            </div>
          ) : null}
          {lane.status === "error" ? (
            <div className="absolute inset-0 flex items-center justify-center px-4">
              <p className="text-center text-xs text-destructive">
                {lane.error ? xgMessage(lane.error) : "Playback failed"}
              </p>
            </div>
          ) : null}
          {lane.inGap && lane.status !== "error" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/80">
              <p className="text-sm font-medium text-white/90">
                No video recorded
              </p>
              <p className="text-xs text-white/60">
                There is no footage for this part of the timeline.
              </p>
            </div>
          ) : null}
          {notice ? (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-white/90">
              {`Skipped ${formatDuration(notice.toTs - notice.fromTs)} with no video`}
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
