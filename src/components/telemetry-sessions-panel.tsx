import { useState } from "react"
import type { ReplayTelemetrySession, TelemetrySession } from "@xorgate/sdk"
import { DatabaseIcon, DownloadIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { formatDateTime } from "@/lib/format-time"
import {
  TELEMETRY_HOT_WINDOW_DAYS,
  collectSessionSegments,
} from "@/lib/telemetry-export"
import { xg, xgMessage } from "@/lib/xorgate"
import { useTelemetrySessions } from "@/queries/telemetry-sessions"

/**
 * "Recorded sessions": the door from the Telemetry History page to the
 * per-session artifacts (telemetry-session-artifacts plan, P5 5.5).
 *
 * The history table and its CSV export read `telemetry_readings`, which keeps
 * only the last TELEMETRY_HOT_WINDOW_DAYS of samples (README D8/D9). The
 * record for recorded telemetry is the session artifacts in S3: the device's
 * own gzipped segments and one precomputed overview per session, kept for a
 * year. This panel lists the sessions overlapping the page's range (any range
 * when the page shows "All") and downloads either artifact through the same
 * presigned URLs the replay uses (`media.replayManifest` over the session's
 * own span). Nothing here touches the history endpoint, so it works exactly
 * the same for a session whose rows are long gone.
 */
export function RecordedSessionsPanel({
  deviceId,
  from,
  to,
}: {
  deviceId: string
  from?: string
  to?: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const query = useTelemetrySessions(
    deviceId,
    { from, to, limit: 50 },
    { enabled: open }
  )
  const sessions = query.data?.sessions ?? []
  const total = query.data?.total ?? 0

  const run = async (
    session: TelemetrySession,
    kind: "overview" | "segments"
  ) => {
    setBusy(`${session.id}:${kind}`)
    try {
      const found = await manifestSession(deviceId, session)
      if (kind === "overview") {
        if (!found.overview) {
          toast.info(
            session.status === "open"
              ? "This session is still receiving segments; its overview is built after it closes."
              : "This session's overview has not been built yet. Try again in a minute."
          )
          return
        }
        const res = await fetch(found.overview.url)
        if (!res.ok) throw new Error(`overview fetch failed (${res.status})`)
        downloadBlob(
          await res.blob(),
          `telemetry-${deviceId}-${session.id}-overview.v1.json`
        )
        return
      }
      const result = await collectSessionSegments(found, async (url) => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`segment fetch failed (${res.status})`)
        return res.text()
      })
      downloadBlob(
        new Blob([result.text], { type: "application/x-ndjson" }),
        `telemetry-${deviceId}-${session.id}-segments.jsonl`
      )
      toast.success(
        `${result.samples.toLocaleString()} samples from ${result.segments} segment${result.segments === 1 ? "" : "s"}`
      )
    } catch (err) {
      toast.error(`Download failed: ${xgMessage(err)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5">
          <DatabaseIcon className="size-3.5" />
          Recorded sessions
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[26rem] p-3" align="start">
        <p className="text-xs text-muted-foreground">
          History keeps the last {TELEMETRY_HOT_WINDOW_DAYS} days of samples.
          Each recording session is also kept for a year as artifacts: a
          precomputed overview (JSON) and the device&apos;s raw segments
          (JSONL), downloadable here{from || to ? " for this range" : ""}.
        </p>
        <div className="mt-2 max-h-72 overflow-y-auto">
          {query.isLoading ? (
            <p className="py-3 text-xs text-muted-foreground">Loading sessions…</p>
          ) : query.error ? (
            <p className="py-3 text-xs text-destructive">{xgMessage(query.error)}</p>
          ) : sessions.length === 0 ? (
            <p className="py-3 text-xs text-muted-foreground">
              No recorded sessions{from || to ? " in this range" : ""}.
            </p>
          ) : (
            <ul className="divide-y">
              {sessions.map((s) => {
                const distance = distanceKm(s)
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="tabular-nums">{formatDateTime(s.from)}</span>
                        {s.status === "open" ? (
                          <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                            receiving
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">
                        {fmtDuration(Date.parse(s.to) - Date.parse(s.from))} ·{" "}
                        {s.samples.toLocaleString()} samples
                        {distance !== null ? ` · ${distance} km` : ""}
                        {s.timeSource && s.timeSource !== "ntp" ? ` · clock ${s.timeSource}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        disabled={busy !== null || !s.overviewBuiltAt}
                        title={s.overviewBuiltAt ? "Download the overview (JSON)" : "Overview not built yet"}
                        onClick={() => run(s, "overview")}
                      >
                        {busy === `${s.id}:overview` ? (
                          <Loader2Icon className="size-3 animate-spin" />
                        ) : (
                          <DownloadIcon className="size-3" />
                        )}
                        Overview
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        disabled={busy !== null || s.segments === 0}
                        title="Download the raw segments (JSONL)"
                        onClick={() => run(s, "segments")}
                      >
                        {busy === `${s.id}:segments` ? (
                          <Loader2Icon className="size-3 animate-spin" />
                        ) : (
                          <DownloadIcon className="size-3" />
                        )}
                        Raw
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {total > sessions.length ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Newest {sessions.length} of {total.toLocaleString()} sessions. Narrow
            the date range for older ones.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/**
 * The session's entry in the replay manifest for its own span: that is where
 * the presigned artifact URLs come from (README D3), and the only place. One
 * second past the last sample so an exclusive `to` still covers it.
 */
async function manifestSession(
  deviceId: string,
  session: TelemetrySession
): Promise<ReplayTelemetrySession> {
  const replay = await xg().media.replayManifest(deviceId, {
    from: session.from,
    to: new Date(Date.parse(session.to) + 1000),
  })
  const found = replay.telemetry?.sessions.find((s) => s.id === session.id)
  if (!found) {
    throw new Error(
      replay.telemetry
        ? "The replay manifest does not list this session's artifacts (they may have expired)"
        : "This server does not serve telemetry artifacts yet"
    )
  }
  return found
}

function distanceKm(s: TelemetrySession): string | null {
  const meters = s.insights?.distance?.meters
  return typeof meters === "number" ? (meters / 1000).toFixed(1) : null
}

function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "–"
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
