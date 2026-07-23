import { useCallback, useEffect, useState } from "react"
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

// Sessions recorded ON the device (offline recording plan) — uploaded
// segment-by-segment when connectivity allows, so a session can still be
// filling in ("open") long after the drive ended. Expand a session for its
// ordered segment index with per-segment playback.
export function DeviceSessionsCard({ deviceId }: { deviceId: string }) {
  const [sessions, setSessions] = useState<MediaSession[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [segmentsBySession, setSegmentsBySession] = useState<
    Record<string, MediaSegment[]>
  >({})
  const [segmentsLoading, setSegmentsLoading] = useState(false)

  const [playing, setPlaying] = useState<{
    session: MediaSession
    segment: MediaSegment
  } | null>(null)
  const [playUrl, setPlayUrl] = useState<string | null>(null)

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
      if (expandedId) void refreshSegments(expandedId).catch(() => {})
    }, POLL_MS)
    return () => clearInterval(t)
  }, [refresh, refreshSegments, expandedId])

  async function toggleExpand(session: MediaSession) {
    if (expandedId === session.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(session.id)
    if (!segmentsBySession[session.id]) {
      setSegmentsLoading(true)
      try {
        await refreshSegments(session.id)
      } catch (err) {
        toast.error((err as Error).message)
        setExpandedId(null)
      } finally {
        setSegmentsLoading(false)
      }
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
  const rows = sessions ?? []

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="px-4 pt-4 pb-3">
        <CardTitle className="text-sm">On-device recordings</CardTitle>
        <CardDescription>
          Recorded on the device itself (works offline) and uploaded when
          connected. A session is one continuous run per camera; expand it to
          play individual segments.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col p-0">
        {loadError && rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-destructive">{loadError}</p>
        ) : loading ? (
          <div className="flex flex-col gap-2 px-4 py-4">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No on-device recordings yet. Turn on &quot;Record on device&quot; in
            Settings to capture drives even while offline.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className={HEAD}>Stream</TableHead>
                <TableHead className={HEAD}>Started</TableHead>
                <TableHead className={`${HEAD} text-right`}>Duration</TableHead>
                <TableHead className={`${HEAD} text-right`}>Size</TableHead>
                <TableHead className={`${HEAD} text-right`}>Segments</TableHead>
                <TableHead className={HEAD}>Quality</TableHead>
                <TableHead className={HEAD}>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => {
                const expanded = expandedId === s.id
                const segments = segmentsBySession[s.id]
                return [
                  <TableRow
                    key={s.id}
                    onClick={() => void toggleExpand(s)}
                    className="cursor-pointer"
                  >
                    <TableCell className="w-8 pl-3 text-muted-foreground">
                      {expanded ? (
                        <ChevronDownIcon className="size-4" />
                      ) : (
                        <ChevronRightIcon className="size-4" />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
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
                  </TableRow>,
                  expanded ? (
                    <TableRow key={`${s.id}-segments`} className="hover:bg-transparent">
                      <TableCell colSpan={8} className="bg-muted/30 p-0">
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
        )}
        {total > PAGE_SIZE ? (
          <div className="border-t border-border px-3 py-3">
            <DataTablePagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              rowsOnPage={rows.length}
              pageSizes={[PAGE_SIZE]}
              onPageChange={(p) => {
                setExpandedId(null)
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
    </Card>
  )
}
