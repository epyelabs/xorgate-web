import { useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { ArrowRightIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatBytes, formatDuration } from "@/components/data-table"
import { getDeviceSessions, type MediaSession } from "@/lib/api"
import { getDeviceSessionsResponseSchema } from "@/lib/schemas"
import {
  clusterRuns,
  runReplayBlocked,
  runReplaySearch,
} from "@/lib/replay/runs"

// Overview's glance surface for on-device recordings (recorder-removal plan,
// decision G) — it replaces the cloud recorder's "Recent media recordings"
// section that Phase 1 deleted. Deliberately NOT `DeviceSessionsCard`: no
// filters, no pagination, no 3-level expansion. Just the newest few runs and a
// door into the Media tab.
// Fetch comfortably more sessions than the runs we show: a run is N per-camera
// sessions and a long one can be 16+, so a tight limit truncates the oldest run
// and reports a wrong start/duration for it (observed: 69m for a run the Media
// tab correctly shows as 83m).
const SESSION_FETCH_LIMIT = 40
const RECENT_RUNS = 4

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

const HEAD = "text-[10px] tracking-[0.14em] uppercase text-muted-foreground"

export function RecentSessionsSection({
  deviceId,
  recordingEnabled,
}: {
  deviceId: string
  // Drives the empty-state hint: "turn it on" only makes sense when it is off.
  recordingEnabled?: boolean
}) {
  const [sessions, setSessions] = useState<MediaSession[] | null>(null)

  // Load once on mount — Overview's other panels (device, model, recent
  // telemetry) fetch once too; the Media tab owns the 5 s live cadence.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const raw = await getDeviceSessions(deviceId, {
          limit: SESSION_FETCH_LIMIT,
          order: "desc",
          sort: "startedAt",
        })
        const parsed = getDeviceSessionsResponseSchema.safeParse(raw)
        if (!cancelled) setSessions(parsed.success ? parsed.data.sessions : [])
      } catch {
        if (!cancelled) setSessions([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [deviceId])

  // Same `clusterRuns` the Media tab uses, so both agree on what a "run" is.
  // If the response filled the limit, its OLDEST cluster may be cut off at the
  // page boundary — drop it rather than render a run with a wrong start and
  // duration. (`clusterRuns` returns newest-first, so that is the last one.)
  const clustered = clusterRuns(sessions ?? [])
  const complete =
    (sessions?.length ?? 0) >= SESSION_FETCH_LIMIT && clustered.length > 1
      ? clustered.slice(0, -1)
      : clustered
  const runs = complete.slice(0, RECENT_RUNS)
  const loading = sessions === null

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-heading text-sm font-medium">
            Recent on-device recordings
          </h2>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/devices/$id/media" params={{ id: deviceId }}>
            View all
            <ArrowRightIcon />
          </Link>
        </Button>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex flex-col gap-2 px-4 py-4">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : runs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No on-device recordings yet.
              {recordingEnabled === false ? (
                <>
                  {" "}
                  Turn on{" "}
                  <Link
                    to="/devices/$id/settings"
                    params={{ id: deviceId }}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    &quot;Record on device&quot;
                  </Link>{" "}
                  in Settings to capture drives even while offline.
                </>
              ) : null}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={`${HEAD} pl-4`}>Started</TableHead>
                  <TableHead className={`${HEAD} text-right`}>
                    Duration
                  </TableHead>
                  <TableHead className={HEAD}>Cameras</TableHead>
                  <TableHead className={`${HEAD} text-right`}>Size</TableHead>
                  <TableHead className={HEAD}>Status</TableHead>
                  <TableHead className={`${HEAD} pr-4 text-right`}>
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => {
                  const blocked = runReplayBlocked(run)
                  return (
                    <TableRow key={run.key}>
                      <TableCell className="pl-4 text-xs">
                        {dateTimeFormat.format(new Date(run.fromMs))}
                        {run.anyUnsynced ? (
                          <Badge
                            variant="outline"
                            className="ml-2 text-[10px]"
                            title="The device clock was not synchronized when this was recorded — times may be wrong."
                          >
                            clock unsynced
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatDuration(run.toMs - run.fromMs)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {run.streamKeys.map((k) => (
                            <Badge
                              key={k}
                              variant="outline"
                              className="font-mono text-[10px]"
                            >
                              {k}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatBytes(run.totalBytes)}
                      </TableCell>
                      <TableCell>
                        {run.anyOpen ? (
                          <Badge
                            variant="secondary"
                            title="Segments may still be arriving (recording, or uploading a backlog)."
                          >
                            <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
                            Receiving
                          </Badge>
                        ) : (
                          <Badge variant="outline">Complete</Badge>
                        )}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={blocked !== null}
                          title={blocked ?? undefined}
                          asChild={blocked === null}
                        >
                          {blocked === null ? (
                            <Link
                              to="/devices/$id/replay"
                              params={{ id: deviceId }}
                              search={runReplaySearch(run)}
                            >
                              Replay
                            </Link>
                          ) : (
                            <span>Replay</span>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
