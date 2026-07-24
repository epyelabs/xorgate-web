import { useMemo, useRef, useState } from "react"
import {
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { formatDuration } from "@/components/data-table"
import { formatDateTime } from "@/lib/format-time"
import { cn } from "@/lib/utils"
import {
  REPLAY_RATES,
  type ReplayClock,
  type ReplayRate,
} from "@/lib/replay/replay-clock"
import {
  nextBoundary,
  prevBoundary,
  segmentEnd,
  type ReplayTimeline as Timeline,
} from "@/lib/replay/timeline"
import { useReplayClockState } from "@/hooks/use-replay-clock"

const timeFmt = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" })

// Contiguous segments merge into single coverage blocks (a 1 h soak is one
// run, not 61 divs). 50 ms slop absorbs ms-rounding at seams.
function coverageRuns(timeline: Timeline): { fromTs: number; toTs: number }[] {
  const runs: { fromTs: number; toTs: number }[] = []
  for (const seg of timeline.segments) {
    const end = segmentEnd(seg)
    const last = runs[runs.length - 1]
    if (last && seg.startTs <= last.toTs + 50) {
      last.toTs = Math.max(last.toTs, end)
    } else {
      runs.push({ fromTs: seg.startTs, toTs: end })
    }
  }
  return runs
}

/**
 * Replay transport chrome (page-level, not part of StreamsView — R8): the
 * wall-clock scrubber with video-coverage blocks, hatched gaps and partial
 * markers, plus play/pause, rate, boundary jumps, gap auto-skip and the
 * playhead's wall-clock readout. Pure follower/commander of the replay clock.
 */
export function ReplayTimelineBar({
  clock,
  timeline,
}: {
  clock: ReplayClock
  timeline: Timeline
}) {
  const state = useReplayClockState(clock)
  const trackRef = useRef<HTMLDivElement>(null)
  const [hoverTs, setHoverTs] = useState<number | null>(null)

  const span = timeline.to - timeline.from
  const runs = useMemo(() => coverageRuns(timeline), [timeline])
  const partials = useMemo(
    () => timeline.segments.filter((s) => !s.finalized),
    [timeline]
  )

  if (!state) return null
  const pct = (ts: number) => ((ts - timeline.from) / span) * 100

  const tsAtClientX = (clientX: number): number => {
    const track = trackRef.current
    if (!track) return timeline.from
    const rect = track.getBoundingClientRect()
    const frac = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
    return timeline.from + frac * span
  }

  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex flex-col gap-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur-sm">
      {/* Scrubber. The outer div is the (taller) hit area; the inner track is
          the visible bar. Pointer capture makes drag-scrubbing work even when
          the cursor leaves the track. */}
      <div
        ref={trackRef}
        className="group relative h-6 cursor-pointer touch-none select-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          clock.seek(tsAtClientX(e.clientX))
        }}
        onPointerMove={(e) => {
          setHoverTs(tsAtClientX(e.clientX))
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            clock.seek(tsAtClientX(e.clientX))
          }
        }}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
        onPointerLeave={() => setHoverTs(null)}
      >
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-muted">
          {/* Video coverage */}
          {runs.map((r) => (
            <div
              key={r.fromTs}
              className="absolute inset-y-0 bg-primary/50"
              style={{
                left: `${pct(r.fromTs)}%`,
                width: `${pct(r.toTs) - pct(r.fromTs)}%`,
              }}
            />
          ))}
          {/* Gaps: hatched so "no video" reads differently from "just empty" */}
          {timeline.gaps.map((g) => (
            <div
              key={g.fromTs}
              title={
                g.reason === "evicted-head"
                  ? "Oldest footage was deleted on the device before upload"
                  : "No video recorded for this stretch"
              }
              className="absolute inset-y-0 [background:repeating-linear-gradient(-45deg,var(--color-muted-foreground)_0_2px,transparent_2px_6px)] opacity-40"
              style={{
                left: `${pct(g.fromTs)}%`,
                width: `${pct(g.toTs) - pct(g.fromTs)}%`,
              }}
            />
          ))}
          {/* Crash-cut (partial) segment markers */}
          {partials.map((s) => (
            <div
              key={s.seq}
              title="Recording was cut mid-segment (power loss or crash) — playable up to the cut."
              className="absolute inset-y-0 w-0.5 bg-amber-500"
              style={{ left: `${pct(segmentEnd(s))}%` }}
            />
          ))}
        </div>
        {/* Playhead */}
        <div
          className="pointer-events-none absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-primary"
          style={{ left: `${pct(state.playheadTs)}%` }}
        >
          <div className="absolute -top-0.5 left-1/2 size-2 -translate-x-1/2 rounded-full bg-primary shadow" />
        </div>
        {/* Hover wall-clock tooltip */}
        {hoverTs !== null ? (
          <div
            className="pointer-events-none absolute -top-6 -translate-x-1/2 rounded bg-foreground px-1.5 py-0.5 text-[10px] whitespace-nowrap text-background tabular-nums"
            style={{ left: `${pct(hoverTs)}%` }}
          >
            {timeFmt.format(hoverTs)}
          </div>
        ) : null}
      </div>

      {/* Transport row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            title="Previous segment boundary"
            aria-label="Previous segment boundary"
            onClick={() => clock.seek(prevBoundary(timeline, state.playheadTs))}
          >
            <SkipBackIcon className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="secondary"
            title={state.playing ? "Pause" : "Play"}
            aria-label={state.playing ? "Pause" : "Play"}
            onClick={() => (state.playing ? clock.pause() : clock.play())}
          >
            {state.playing ? (
              <PauseIcon className="size-4" />
            ) : (
              <PlayIcon className="size-4" />
            )}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            title="Next segment boundary"
            aria-label="Next segment boundary"
            onClick={() => clock.seek(nextBoundary(timeline, state.playheadTs))}
          >
            <SkipForwardIcon className="size-4" />
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="w-14 tabular-nums"
              title="Playback rate"
            >
              {state.rate}×
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {REPLAY_RATES.map((r: ReplayRate) => (
              <DropdownMenuItem
                key={r}
                onSelect={() => clock.setRate(r)}
                className={cn("tabular-nums", r === state.rate && "font-semibold")}
              >
                {r}×
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-1.5">
          <Switch
            id="replay-skip-gaps"
            checked={state.skipGaps}
            onCheckedChange={(v) => clock.setSkipGaps(v === true)}
          />
          <Label
            htmlFor="replay-skip-gaps"
            className="text-xs text-muted-foreground"
            title="Jump over stretches with no video instead of waiting through them"
          >
            Skip gaps
          </Label>
        </div>

        <div className="ml-auto flex items-baseline gap-2 text-xs tabular-nums">
          <span className="font-medium">{formatDateTime(state.playheadTs)}</span>
          <span className="text-muted-foreground">
            {formatDuration(state.playheadTs - timeline.from)} /{" "}
            {formatDuration(span)} · local time
          </span>
        </div>
      </div>
    </div>
  )
}
