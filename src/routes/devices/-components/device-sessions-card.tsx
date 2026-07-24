import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DataTablePagination,
  formatBytes,
  formatDuration,
} from "@/components/data-table"
import {
  deleteDeviceSession,
  getDeviceSessions,
  getSessionSegments,
  getSegmentPlaybackUrl,
  type MediaSegment,
  type MediaSession,
} from "@/lib/api"
import {
  getDeviceSessionsResponseSchema,
  getSessionSegmentsResponseSchema,
} from "@/lib/schemas"
import {
  clusterRuns,
  runReplayBlocked,
  runReplaySearch,
  type RecordingRun,
} from "@/lib/replay/runs"

const POLL_MS = 5000
const PAGE_SIZE = 25

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
})

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? iso : dateTimeFormat.format(parsed)
}

const HEAD =
  "text-[10px] tracking-[0.14em] uppercase text-muted-foreground"

// Sessions recorded ON the device (offline recording plan), grouped into
// RECORDING RUNS (composite replays plan, R9): one drive with N cameras
// produces N per-cam sessions that cluster by time overlap into one run row —
// the unit a human means by "that drive". The run's Replay is time-anchored
// (composite: every camera with coverage joins automatically); expand a run
// for its per-camera sessions (single-cam replay, delete), and a session for
// its ordered segment index with per-segment playback.
export function DeviceSessionsCard({ deviceId }: { deviceId: string }) {
  const [sessions, setSessions] = useState<MediaSession[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [expandedRunKey, setExpandedRunKey] = useState<string | null>(null)
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(
    null
  )
  const [segmentsBySession, setSegmentsBySession] = useState<
    Record<string, MediaSegment[]>
  >({})
  const [segmentsLoading, setSegmentsLoading] = useState(false)

  const [playing, setPlaying] = useState<{
    session: MediaSession
    segment: MediaSegment
  } | null>(null)
  const [playUrl, setPlayUrl] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<MediaSession | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const refreshSegments = useCallback(
    async (sessionId: string) => {
      const raw = await getSessionSegments(deviceId, sessionId)
      const parsed = getSessionSegmentsResponseSchema.safeParse(raw)
      if (!parsed.success) throw new Error("Unexpected segments response")
      setSegmentsBySession((prev) => ({
        ...prev,
        [sessionId]: parsed.data.segments,
      }))
    },
    [deviceId]
  )

  const refresh = useCallback(async () => {
    try {
      const raw = await getDeviceSessions(deviceId, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        order: "desc",
        sort: "startedAt",
      })
      const parsed = getDeviceSessionsResponseSchema.safeParse(raw)
      if (!parsed.success) throw new Error("Unexpected sessions response")
      setSessions(parsed.data.sessions)
      setTotal(parsed.data.page?.total ?? parsed.data.sessions.length)
      setLoadError(null)
    } catch (err) {
      setLoadError((err as Error).message)
    }
  }, [deviceId, page])

  // 5 s polling (same convention as the recordings table) so open sessions'
  // rollups keep growing while a backlog drains. The expanded session's
  // segment list refreshes on the same tick.
  useEffect(() => {
    void refresh()
    const t = setInterval(() => {
      void refresh()
      if (expandedSessionId) void refreshSegments(expandedSessionId).catch(() => {})
    }, POLL_MS)
    return () => clearInterval(t)
  }, [refresh, refreshSegments, expandedSessionId])

  // Runs are clustered within the fetched page (R9: client-side first; a run
  // straddling a page boundary shows as two partial runs — move server-side
  // only if that proves annoying on real data).
  const runs = useMemo(() => clusterRuns(sessions ?? []), [sessions])

  function toggleRun(run: RecordingRun) {
    const next = expandedRunKey === run.key ? null : run.key
    setExpandedRunKey(next)
    if (next === null) setExpandedSessionId(null)
  }

  async function toggleSession(session: MediaSession) {
    if (expandedSessionId === session.id) {
      setExpandedSessionId(null)
      return
    }
    setExpandedSessionId(session.id)
    if (!segmentsBySession[session.id]) {
      setSegmentsLoading(true)
      try {
        await refreshSegments(session.id)
      } catch (err) {
        toast.error((err as Error).message)
        setExpandedSessionId(null)
      } finally {
        setSegmentsLoading(false)
      }
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await deleteDeviceSession(deviceId, deleting.id)
      toast.success("Session deleted")
      if (expandedSessionId === deleting.id) setExpandedSessionId(null)
      setDeleting(null)
      await refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setDeleteBusy(false)
    }
  }

  async function openPlayer(session: MediaSession, segment: MediaSegment) {
    setPlaying({ session, segment })
    setPlayUrl(null)
    try {
      const { url } = await getSegmentPlaybackUrl(
        deviceId,
        session.id,
        segment.seq
      )
      setPlayUrl(url)
    } catch (err) {
      toast.error((err as Error).message)
      setPlaying(null)
    }
  }

  const loading = sessions === null && loadError === null

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="px-4 pt-4 pb-3">
        <CardTitle className="text-sm">On-device recordings</CardTitle>
        <CardDescription>
          Recorded on the device itself (works offline) and uploaded when
          connected. One row per recording run — all cameras that were rolling
          together. Replay plays every camera in sync; expand a run for its
          per-camera sessions.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col p-0">
        {loadError && runs.length === 0 ? (
          <p className="px-4 py-6 text-sm text-destructive">{loadError}</p>
        ) : loading ? (
          <div className="flex flex-col gap-2 px-4 py-4">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : runs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No on-device recordings yet. Turn on &quot;Record on device&quot; in
            Settings to capture drives even while offline.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className={HEAD}>Started</TableHead>
                <TableHead className={`${HEAD} text-right`}>Duration</TableHead>
                <TableHead className={HEAD}>Cameras</TableHead>
                <TableHead className={`${HEAD} text-right`}>Size</TableHead>
                <TableHead className={`${HEAD} text-right`}>Segments</TableHead>
                <TableHead className={HEAD}>Status</TableHead>
                <TableHead className={`${HEAD} text-right pr-4`}>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const expanded = expandedRunKey === run.key
                const blocked = runReplayBlocked(run)
                return [
                  <TableRow
                    key={run.key}
                    onClick={() => toggleRun(run)}
                    className="cursor-pointer"
                  >
                    <TableCell className="w-8 pl-3 text-muted-foreground">
                      {expanded ? (
                        <ChevronDownIcon className="size-4" />
                      ) : (
                        <ChevronRightIcon className="size-4" />
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
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
                    <TableCell className="text-right text-xs tabular-nums">
                      {run.segmentCount}
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
                      {/* Time-anchored composite replay (R9): every camera
                          with coverage in the run's window appears. */}
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={blocked !== null}
                        title={blocked ?? undefined}
                        asChild={blocked === null}
                        onClick={(e) => e.stopPropagation()}
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
                  </TableRow>,
                  expanded ? (
                    <TableRow
                      key={`${run.key}-sessions`}
                      className="hover:bg-transparent"
                    >
                      <TableCell colSpan={8} className="bg-muted/20 p-0">
                        <Table>
                          <TableHeader>
                            <TableRow className="hover:bg-transparent">
                              <TableHead className="w-8" />
                              <TableHead className={`${HEAD} pl-2`}>Stream</TableHead>
                              <TableHead className={HEAD}>Started</TableHead>
                              <TableHead className={`${HEAD} text-right`}>
                                Duration
                              </TableHead>
                              <TableHead className={`${HEAD} text-right`}>
                                Size
                              </TableHead>
                              <TableHead className={`${HEAD} text-right`}>
                                Segments
                              </TableHead>
                              <TableHead className={HEAD}>Quality</TableHead>
                              <TableHead className={HEAD}>Status</TableHead>
                              <TableHead className={`${HEAD} text-right pr-4`}>
                                Actions
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {run.sessions.map((s) => {
                              const sessionExpanded = expandedSessionId === s.id
                              const segments = segmentsBySession[s.id]
                              return [
                                <TableRow
                                  key={s.id}
                                  onClick={() => void toggleSession(s)}
                                  className="cursor-pointer hover:bg-muted/40"
                                >
                                  <TableCell className="w-8 pl-6 text-muted-foreground">
                                    {sessionExpanded ? (
                                      <ChevronDownIcon className="size-4" />
                                    ) : (
                                      <ChevronRightIcon className="size-4" />
                                    )}
                                  </TableCell>
                                  <TableCell className="pl-2 font-mono text-xs">
                                    {s.streamKey}
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    {formatTimestamp(s.startedAt)}
                                    {s.timeSource === "unsynced" ? (
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
                                    {formatDuration(s.totalDurationMs)}
                                  </TableCell>
                                  <TableCell className="text-right text-xs tabular-nums">
                                    {formatBytes(s.totalBytes)}
                                  </TableCell>
                                  <TableCell className="text-right text-xs tabular-nums">
                                    {s.segmentCount}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {s.width && s.height
                                      ? `${s.width}×${s.height}${s.fps ? `@${s.fps}` : ""}`
                                      : "—"}
                                  </TableCell>
                                  <TableCell>
                                    {s.status === "open" ? (
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
                                    <div className="flex items-center justify-end gap-2">
                                      {/* Single-camera replay of just this
                                          session (`?session=` sugar, R9). */}
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        disabled={s.segmentCount === 0}
                                        asChild={s.segmentCount > 0}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {s.segmentCount > 0 ? (
                                          <Link
                                            to="/devices/$id/replay"
                                            params={{ id: deviceId }}
                                            search={{ session: s.id }}
                                          >
                                            Replay
                                          </Link>
                                        ) : (
                                          <span>Replay</span>
                                        )}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setDeleting(s)
                                        }}
                                      >
                                        Delete
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>,
                                sessionExpanded ? (
                                  <TableRow
                                    key={`${s.id}-segments`}
                                    className="hover:bg-transparent"
                                  >
                                    <TableCell colSpan={9} className="bg-muted/40 p-0">
                                      {segmentsLoading && !segments ? (
                                        <div className="flex flex-col gap-2 px-10 py-4">
                                          <Skeleton className="h-5 w-full" />
                                          <Skeleton className="h-5 w-full" />
                                        </div>
                                      ) : (segments ?? []).length === 0 ? (
                                        <p className="px-10 py-4 text-xs text-muted-foreground">
                                          No segments uploaded yet.
                                        </p>
                                      ) : (
                                        <Table>
                                          <TableHeader>
                                            <TableRow className="hover:bg-transparent">
                                              <TableHead className={`${HEAD} w-14 pl-10`}>#</TableHead>
                                              <TableHead className={HEAD}>Start</TableHead>
                                              <TableHead className={`${HEAD} text-right`}>
                                                Duration
                                              </TableHead>
                                              <TableHead className={`${HEAD} text-right`}>
                                                Size
                                              </TableHead>
                                              <TableHead className={HEAD} />
                                              <TableHead className={`${HEAD} text-right pr-4`}>
                                                Actions
                                              </TableHead>
                                            </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                            {(segments ?? []).map((seg) => (
                                              <TableRow key={seg.id} className="hover:bg-muted/40">
                                                <TableCell className="pl-10 text-xs tabular-nums text-muted-foreground">
                                                  {seg.seq}
                                                </TableCell>
                                                <TableCell className="text-xs">
                                                  {formatTimestamp(seg.startTs)}
                                                </TableCell>
                                                <TableCell className="text-right text-xs tabular-nums">
                                                  {formatDuration(seg.durationMs)}
                                                </TableCell>
                                                <TableCell className="text-right text-xs tabular-nums">
                                                  {formatBytes(seg.sizeBytes)}
                                                </TableCell>
                                                <TableCell>
                                                  {!seg.finalized ? (
                                                    <Badge
                                                      variant="outline"
                                                      className="text-[10px]"
                                                      title="Recording was cut mid-segment (power loss or crash). Playable up to the cut."
                                                    >
                                                      partial
                                                    </Badge>
                                                  ) : null}
                                                </TableCell>
                                                <TableCell className="pr-4 text-right">
                                                  <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    onClick={() => void openPlayer(s, seg)}
                                                  >
                                                    Play
                                                  </Button>
                                                </TableCell>
                                              </TableRow>
                                            ))}
                                          </TableBody>
                                        </Table>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ) : null,
                              ]
                            })}
                          </TableBody>
                        </Table>
                      </TableCell>
                    </TableRow>
                  ) : null,
                ]
              })}
            </TableBody>
          </Table>
        )}
        {total > PAGE_SIZE ? (
          <div className="border-t border-border px-3 py-3">
            <DataTablePagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              rowsOnPage={sessions?.length ?? 0}
              pageSizes={[PAGE_SIZE]}
              onPageChange={(p) => {
                setExpandedRunKey(null)
                setExpandedSessionId(null)
                setPage(p)
              }}
              onPageSizeChange={() => {}}
            />
          </div>
        ) : null}
      </CardContent>

      {/* Segment playback dialog — same pattern as recordings-table.tsx. */}
      <Dialog
        open={playing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPlaying(null)
            setPlayUrl(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {playing
                ? `${playing.session.streamKey} · segment ${playing.segment.seq} · ${formatTimestamp(playing.segment.startTs)}`
                : "Segment"}
            </DialogTitle>
            <DialogDescription>
              Playback from S3 (link expires).
              {playing && !playing.segment.finalized
                ? " This segment was cut mid-recording and plays up to the cut."
                : ""}
            </DialogDescription>
          </DialogHeader>
          {!playUrl ? (
            <Skeleton className="aspect-video w-full" />
          ) : (
            <video
              src={playUrl}
              controls
              autoPlay
              className="aspect-video w-full rounded bg-black"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog — same pattern as recordings-table.tsx. */}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleting(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete session?</DialogTitle>
            <DialogDescription>
              This permanently deletes the on-device recording session
              {deleting
                ? ` from ${deleting.streamKey} (${formatTimestamp(deleting.startedAt)}, ${deleting.segmentCount} segments, ${formatBytes(deleting.totalBytes)})`
                : ""}
              {" "}— every segment file in storage and its index. This cannot
              be undone. Other cameras in the same run are not affected.
              {deleting?.status === "open"
                ? " This session may still be receiving segments; anything the device uploads afterwards will reappear here."
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleteBusy}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteBusy}
              onClick={() => void confirmDelete()}
            >
              {deleteBusy ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
