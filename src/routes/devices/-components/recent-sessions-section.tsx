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
import { useSessionRuns } from "@/queries/media"
import { runReplayBlocked, runReplaySearch } from "@/lib/replay/runs"

// Overview's glance surface for on-device recordings (recorder-removal plan,
// decision G) — it replaces the cloud recorder's "Recent media recordings"
// section that Phase 1 deleted. Deliberately NOT `DeviceSessionsCard`: no
// filters, no pagination, no 3-level expansion. Just the newest few runs and a
// door into the Media tab.
//
// Asks the server for RUNS, so it gets exactly this many, each whole
// (improve-recording-history-fetching Phase 3). It used to over-fetch 40
// sessions and cluster them client-side, then discard the oldest cluster in
// case the limit had cut it in half — a heuristic that still reported a wrong
// start and duration when a run spanned more sessions than the fetch
// (observed: 69m for a run the Media tab correctly showed as 83m). Both
// surfaces now read the same server-side clustering, so they cannot disagree.
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
  // No poll: Overview's other panels fetch once too; the Media tab owns the
  // 5 s live cadence. Cached, so revisiting the Overview renders instantly.
  const runsQuery = useSessionRuns(deviceId, {
    limit: RECENT_RUNS,
    order: "desc",
  })
  // Errors fall through to the empty state, as the old best-effort load did.
  const runs = runsQuery.data?.runs ?? (runsQuery.isError ? [] : null)

  const loading = runs === null

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
          ) : (runs ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No on-device recordings yet.
              {recordingEnabled === false ? (
                <>
                  {" "}
                  Turn on{" "}
                  <Link
                    to="/devices/$id/settings"
                    params={{ id: deviceId }}
                    // `recordingEnabled` is recordingConfig.video.enabled, and
                    // that switch lives on the Media sub-tab.
                    search={{ tab: "media" }}
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
                {(runs ?? []).map((run) => {
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
