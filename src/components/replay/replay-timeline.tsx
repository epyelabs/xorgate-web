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
  HEALTHY_STATUS_CODE,
  statusLegend,
  statusRunAt,
} from "@/lib/device-status"
import {
  REPLAY_RATES,
  deviceStatusFor,
  segmentEnd,
  type ReplayRate,
  type StatusRun,
  type ReplayTimeline as Timeline,
  type UseReplayPlayer,
} from "@xorgate/react"

const timeFmt = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" })

// The status lane spans 22..28 px of the 36 px hit area; hovering from just
// above it (the gap under the bar) down counts as "on the lane".
const LANE_HOVER_FROM_PX = 19

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
 *
 * With `statusRuns` (the status LED's `system.led_state` over the replay, from
 * `useReplayTelemetry`) a thin device-status lane sits under the bar, inside
 * the same hit area so a click on a problem stretch seeks to it, with a legend
 * of the codes present. Healthy runs are drawn muted so the lane reads as
 * "covered" and the coloured stretches stand out.
 */
export function ReplayTimelineBar({
  player,
  timeline,
  statusRuns = [],
  statusRunsSource = null,
}: {
  player: UseReplayPlayer
  timeline: Timeline
  statusRuns?: StatusRun[]
  statusRunsSource?: "insight" | "overview" | null
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [hoverTs, setHoverTs] = useState<number | null>(null)
  // True while the pointer is over the status lane (its lower band): the
  // hover tooltip then names the state under the cursor and its duration.
  const [hoverLane, setHoverLane] = useState(false)

  const span = timeline.to - timeline.from
  const runs = useMemo(() => coverageRuns(timeline), [timeline])
  const hasLane = statusRuns.length > 0
  const legend = useMemo(() => statusLegend(statusRuns), [statusRuns])
  const hoverRun =
    hasLane && hoverLane && hoverTs !== null
      ? statusRunAt(statusRuns, hoverTs)
      : null

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
        className={cn(
          "group relative cursor-pointer touch-none select-none",
          hasLane ? "h-9" : "h-6"
        )}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          player.seek(tsAtClientX(e.clientX))
        }}
        onPointerMove={(e) => {
          setHoverTs(tsAtClientX(e.clientX))
          if (hasLane) {
            const rect = e.currentTarget.getBoundingClientRect()
            setHoverLane(e.clientY - rect.top >= LANE_HOVER_FROM_PX)
          }
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            player.seek(tsAtClientX(e.clientX))
          }
        }}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
        onPointerLeave={() => setHoverTs(null)}
      >
        <div
          className={cn(
            "absolute inset-x-0 h-2 overflow-hidden rounded-full bg-muted",
            hasLane ? "top-2.5" : "top-1/2 -translate-y-1/2"
          )}
        >
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
          {timeline.partialEnds.map((ts) => (
            <div
              key={ts}
              title="Recording was cut mid-segment (power loss or crash) — playable up to the cut."
              className="absolute inset-y-0 w-0.5 bg-amber-500"
              style={{ left: `${pct(ts)}%` }}
            />
          ))}
        </div>
        {/* Device status lane: one block per led_state run, LED colours. */}
        {hasLane ? (
          <div
            className="absolute inset-x-0 top-[22px] h-1.5 overflow-hidden rounded-full bg-muted"
            data-testid="device-status-lane"
            aria-label="Device status over the replay"
          >
            {statusRuns.map((r) => (
              <div
                key={`${r.fromTs}-${r.code}`}
                data-code={r.code}
                className="absolute inset-y-0"
                style={{
                  left: `${pct(r.fromTs)}%`,
                  width: `${Math.max(pct(r.toTs) - pct(r.fromTs), 0.15)}%`,
                  backgroundColor: deviceStatusFor(r.code)?.color,
                  opacity: r.code === HEALTHY_STATUS_CODE ? 0.35 : 1,
                }}
              />
            ))}
          </div>
        ) : null}
        {/* Playhead */}
        <div
          className={cn(
            "pointer-events-none absolute top-1/2 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-primary",
            hasLane ? "h-[26px]" : "h-4"
          )}
          style={{ left: `${pct(player.playheadTs)}%` }}
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
            {hoverRun ? (
              <>
                {" · "}
                {deviceStatusFor(hoverRun.code)?.label} for{" "}
                {formatDuration(hoverRun.toTs - hoverRun.fromTs)}
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Status lane legend: only the codes this replay contains. */}
      {hasLane ? (
        <div
          className="-mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
          data-testid="device-status-legend"
        >
          <span className="font-medium text-foreground/80">Device status</span>
          {legend.map((l) => (
            <span key={l.code} className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block size-2 rounded-full"
                style={{
                  backgroundColor: l.color,
                  opacity: l.code === HEALTHY_STATUS_CODE ? 0.5 : 1,
                }}
              />
              {l.label}
              <span className="tabular-nums opacity-70">
                {formatDuration(l.totalMs)}
              </span>
            </span>
          ))}
          {statusRunsSource === "overview" ? (
            <span
              className="rounded border px-1 text-[10px]"
              title="Drawn from the bucketed session overview (each bucket shows its worst state). Exact intervals appear once the session closes."
            >
              approx.
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Transport row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            title="Previous segment boundary"
            aria-label="Previous segment boundary"
            onClick={() => player.stepBoundary(-1)}
          >
            <SkipBackIcon className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="secondary"
            title={player.playing ? "Pause" : "Play"}
            aria-label={player.playing ? "Pause" : "Play"}
            onClick={() => (player.playing ? player.pause() : player.play())}
          >
            {player.playing ? (
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
            onClick={() => player.stepBoundary(1)}
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
              {player.rate}×
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {REPLAY_RATES.map((r: ReplayRate) => (
              <DropdownMenuItem
                key={r}
                onSelect={() => player.setRate(r)}
                className={cn("tabular-nums", r === player.rate && "font-semibold")}
              >
                {r}×
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-1.5">
          <Switch
            id="replay-skip-gaps"
            checked={player.skipGaps}
            onCheckedChange={(v) => player.setSkipGaps(v === true)}
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
          <span className="font-medium">{formatDateTime(player.playheadTs)}</span>
          <span className="text-muted-foreground">
            {formatDuration(player.playheadTs - timeline.from)} /{" "}
            {formatDuration(span)} · local time
          </span>
        </div>
      </div>
    </div>
  )
}
