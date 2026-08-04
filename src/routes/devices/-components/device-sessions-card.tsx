import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "@tanstack/react-router"
import {
  ArrowDownUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FilterIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  DataTableToolbar,
  DateRangeFilter,
  downloadCsv,
  formatBytes,
  formatDuration,
  toCsv,
  type DateRangeMode,
} from "@/components/data-table"
import {
  deleteDeviceSession,
  getDeviceRuns,
  getDeviceSessions,
  getSessionSegments,
  getSegmentPlaybackUrl,
  type MediaSegment,
  type MediaSession,
  type MediaSessionsListParams,
  type MediaSessionStatus,
} from "@/lib/api"
import {
  getDeviceRunsResponseSchema,
  getDeviceSessionsResponseSchema,
  getSessionSegmentsResponseSchema,
} from "@/lib/schemas"
import {
  runFromApi,
  runReplayBlocked,
  runReplaySearch,
  type RecordingRun,
} from "@/lib/replay/runs"

const POLL_MS = 5000

export const SESSION_PAGE_SIZES = [25, 50, 100, 200]
export const DEFAULT_SESSION_PAGE_SIZE = 25

// The list endpoint sorts on one of two columns and takes a SEPARATE order
// param — it is not free-form column sorting (device-sessions.ts
// `parseListParams({ sortable: ['startedAt', 'createdAt'] })`).
// ⚠️ Only `startedAt` survives under `?group=runs`: a run has no created_at of
// its own (its members were received over whatever span the uploads took), so
// the server rejects `sort=createdAt` with a 400 rather than silently ignoring
// it. Keeping `createdAt` out of this list makes the route drop a stale
// `?sort=createdAt` from the URL instead of sending it.
export type SessionSortKey = "startedAt" | "createdAt"
export const SESSION_SORT_KEYS: SessionSortKey[] = ["startedAt"]

// The REAL on-device session statuses (api.ts `MediaSessionStatus`). The cloud
// recorder's recording/stopping/completed/failed do not exist here. "open" is
// what the table badges as "Receiving" and "closed" as "Complete", so the
// filter exposes the raw status under the labels the rows already show.
export const SESSION_STATUSES: MediaSessionStatus[] = ["open", "closed"]
const STATUS_LABEL: Record<MediaSessionStatus, string> = {
  open: "receiving",
  closed: "complete",
}
const STATUS_OPTIONS: readonly (MediaSessionStatus | "any")[] = [
  "any",
  ...SESSION_STATUSES,
]

const SORT_OPTIONS: {
  sort: SessionSortKey
  order: "asc" | "desc"
  label: string
}[] = [
  { sort: "startedAt", order: "desc", label: "started ↓" },
  { sort: "startedAt", order: "asc", label: "started ↑" },
]

// CSV export pages the same server filters at 200/request up to this many rows
// (same shape the cloud table used) — a hard stop so a device with a huge
// history can't spin forever.
const EXPORT_PAGE_LIMIT = 200
const EXPORT_CAP = 5000

// Debounce for the stream-key box: ⚠️ `DataTableToolbar`'s search slot is a
// plain controlled Input with no debounce of its own, and unlike the cloud
// table's client-side search this one is a SERVER param — so the delay has to
// live here or every keystroke becomes a request.
const SEARCH_DEBOUNCE_MS = 300

// URL-encoded filter state. Every field is optional: absent = the default, so
// the unfiltered view has a clean URL.
export interface SessionsSearch {
  page?: number
  size?: number
  order?: "asc" | "desc"
  sort?: SessionSortKey
  status?: MediaSessionStatus // omitted => "any"
  // ⚠️ Server-side EXACT match (`eq(mediaSessions.streamKey, …)`), not a
  // substring search — see the placeholder + filtered-empty hint.
  streamKey?: string
  range?: DateRangeMode
  from?: string
  to?: string
}

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
//
// The SERVER clusters and paginates runs (`?group=runs`,
// improve-recording-history-fetching Phase 3), so every page holds exactly
// `size` runs and a run can never straddle a page boundary. Filters pick which
// runs to show, never which sessions to cluster — a run matching on `cam0`
// still arrives with every camera it recorded.
export function DeviceSessionsCard({
  deviceId,
  search,
  onSearchChange,
}: {
  deviceId: string
  search: SessionsSearch
  // Patch the URL search params. Any filter change must also clear `page`.
  onSearchChange: (patch: Partial<SessionsSearch>) => void
}) {
  const [runs, setRuns] = useState<RecordingRun[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

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

  // --- Filter state, derived from the URL (absent param = default) ---
  const size = search.size ?? DEFAULT_SESSION_PAGE_SIZE
  const page = search.page ?? 1
  const order = search.order ?? "desc"
  const sort: SessionSortKey = search.sort ?? "startedAt"
  const status = search.status
  const streamKey = search.streamKey
  const rangeMode: DateRangeMode = search.range ?? "all"
  // "all" ignores from/to (shows the latest sessions).
  const fromIso = rangeMode === "all" ? undefined : search.from
  const toIso = rangeMode === "all" ? undefined : search.to
  const isFiltered =
    status !== undefined || streamKey !== undefined || rangeMode !== "all"

  // Local draft for the stream-key box so typing stays responsive while the
  // URL/server param lags by the debounce. Resyncs when the param changes from
  // the outside (Clear filters, Back).
  const [streamQuery, setStreamQuery] = useState(streamKey ?? "")
  const [syncedStreamKey, setSyncedStreamKey] = useState(streamKey)
  if (syncedStreamKey !== streamKey) {
    // Adjust-during-render (React's documented alternative to a sync effect).
    setSyncedStreamKey(streamKey)
    setStreamQuery(streamKey ?? "")
  }

  // Every stream key this device has been seen recording, accumulated across
  // loads. Used to make the exact-match semantics discoverable when a filter
  // returns nothing (the current page is empty at that point, so it cannot be
  // derived from `sessions`).
  const [knownStreamKeys, setKnownStreamKeys] = useState<string[]>([])

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    },
    []
  )

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

  // Server-side filtering AND grouping (decision H + Phase 3): status /
  // streamKey / from / to / sort / pagination all go to
  // `GET /devices/{id}/sessions`, so this scales as a device's session count
  // grows. `limit`/`offset` count RUNS here, because that is what the request
  // asks the server to group by.
  const serverParams = useMemo(
    (): MediaSessionsListParams => ({
      limit: size,
      offset: (page - 1) * size,
      order,
      sort,
      status,
      streamKey,
      from: fromIso,
      to: toIso,
    }),
    [size, page, order, sort, status, streamKey, fromIso, toIso]
  )

  // ⚠️ Ordering guard. The 5 s poll means a request with the OLD filters is
  // routinely in flight when a filter changes; without this, the stale
  // response lands second and silently overwrites the filtered page (observed:
  // `?streamKey=cam0` fired, list still showed all 84 sessions). Only the
  // newest request may write state.
  const reqSeq = useRef(0)

  const refresh = useCallback(async () => {
    const seq = ++reqSeq.current
    try {
      const raw = await getDeviceRuns(deviceId, serverParams)
      if (seq !== reqSeq.current) return
      const parsed = getDeviceRunsResponseSchema.safeParse(raw)
      if (!parsed.success) throw new Error("Unexpected runs response")
      // The server already returns runs in the requested order, so there is
      // nothing to re-sort or reverse here.
      setRuns(parsed.data.runs.map(runFromApi))
      setTotal(parsed.data.page?.total ?? parsed.data.runs.length)
      setKnownStreamKeys((prev) => {
        const next = new Set(prev)
        for (const r of parsed.data.runs) for (const k of r.streamKeys) next.add(k)
        return next.size === prev.length ? prev : [...next].sort()
      })
      setLoadError(null)
    } catch (err) {
      if (seq !== reqSeq.current) return
      setLoadError((err as Error).message)
    }
  }, [deviceId, serverParams])

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

  // Sessions carried by the runs on this page — footer detail only; the page
  // itself is measured in runs.
  const sessionsOnPage = useMemo(
    () => (runs ?? []).reduce((n, r) => n + r.sessions.length, 0),
    [runs]
  )

  // --- Filter mutations. Every one resets to page 1: offsets are meaningless
  // across a changed result set. ---
  const update = useCallback(
    (patch: Partial<SessionsSearch>) => {
      setExpandedRunKey(null)
      setExpandedSessionId(null)
      onSearchChange(patch)
    },
    [onSearchChange]
  )

  const setStatus = (s: MediaSessionStatus | "any") =>
    update({ status: s === "any" ? undefined : s, page: undefined })
  const setSort = (s: SessionSortKey, o: "asc" | "desc") =>
    update({
      sort: s === "startedAt" ? undefined : s,
      order: o === "desc" ? undefined : o,
      page: undefined,
    })
  const clearFilters = () =>
    update({
      status: undefined,
      streamKey: undefined,
      range: undefined,
      from: undefined,
      to: undefined,
      page: undefined,
    })

  // Debounced push of the stream-key box into the URL (and thus the request).
  const onStreamQueryChange = (value: string) => {
    setStreamQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const next = value.trim()
      update({ streamKey: next === "" ? undefined : next, page: undefined })
    }, SEARCH_DEBOUNCE_MS)
  }

  async function exportCsv() {
    setExporting(true)
    try {
      // Deliberately the UNGROUPED endpoint: one CSV row per session, and the
      // sessions that match the filter. The table shows runs, but a run is a
      // nested object with no honest flat representation, and under the run
      // filter semantics ("show me the runs cam0 appears in") an export would
      // otherwise include cam1 rows the user did not ask for. So the export
      // stays "the sessions matching these filters" and pages sessions —
      // `page.total` is a session count on this call, which is what the loop
      // below needs.
      const all: MediaSession[] = []
      let off = 0
      let grandTotal = Infinity
      while (off < grandTotal && all.length < EXPORT_CAP) {
        const raw = await getDeviceSessions(deviceId, {
          ...serverParams,
          limit: EXPORT_PAGE_LIMIT,
          offset: off,
        })
        const parsed = getDeviceSessionsResponseSchema.safeParse(raw)
        if (!parsed.success) break
        all.push(...parsed.data.sessions)
        grandTotal = parsed.data.page?.total ?? parsed.data.sessions.length
        if (parsed.data.sessions.length === 0) break
        off += EXPORT_PAGE_LIMIT
      }
      const header = [
        "sessionId",
        "streamKey",
        "startedAt",
        "endedAt",
        "status",
        "timeSource",
        "durationMs",
        "sizeBytes",
        "segments",
        "width",
        "height",
        "fps",
        "codec",
      ]
      downloadCsv(
        toCsv(
          header,
          all.map((s) => [
            s.id,
            s.streamKey,
            s.startedAt,
            s.endedAt ?? "",
            s.status,
            s.timeSource ?? "",
            s.totalDurationMs,
            s.totalBytes,
            s.segmentCount,
            s.width ?? "",
            s.height ?? "",
            s.fps ?? "",
            s.codec ?? "",
          ])
        ),
        `on-device-sessions-${deviceId}.csv`
      )
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`)
    } finally {
      setExporting(false)
    }
  }

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

  const loading = runs === null && loadError === null

  const sortLabel =
    SORT_OPTIONS.find((o) => o.sort === sort && o.order === order)?.label ??
    "started ↓"

  const statusFilter = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7">
          <FilterIcon />
          status: {status ? STATUS_LABEL[status] : "any"}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {STATUS_OPTIONS.map((opt) => (
          <DropdownMenuItem key={opt} onSelect={() => setStatus(opt)}>
            {opt === "any" ? "any" : STATUS_LABEL[opt]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const sortFilter = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7">
          <ArrowDownUpIcon />
          sort: {sortLabel}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {SORT_OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.label}
            onSelect={() => setSort(o.sort, o.order)}
          >
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardContent className="flex flex-col p-0">
        {/* Filters run SERVER-side and select whole RUNS (Phase 3, Q1 option
            b): a run matching on one camera or overlapping the date range comes
            back intact, so no note has to apologise for clipped rows. */}
        <div className="flex flex-col gap-2 border-b border-border px-4 pt-4 pb-3">
          <DataTableToolbar
            filters={
              <>
                <DateRangeFilter
                  value={{ mode: rangeMode, from: search.from, to: search.to }}
                  onChange={(v) =>
                    update({
                      range: v.mode === "all" ? undefined : v.mode,
                      from: v.from,
                      to: v.to,
                      page: undefined,
                    })
                  }
                />
                {statusFilter}
                {sortFilter}
              </>
            }
            search={{
              value: streamQuery,
              onChange: onStreamQueryChange,
              placeholder: "Stream key, e.g. cam0",
            }}
            searchAlign="right"
          />
          {isFiltered ? (
            <p className="text-xs text-muted-foreground">
              {total.toLocaleString()} matching recording
              {total === 1 ? "" : "s"}, shown whole — a run that matches on one
              camera or overlaps the date range still lists every camera and
              segment it recorded.{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={clearFilters}
              >
                Clear filters
              </button>
            </p>
          ) : null}
        </div>
        {loadError && (runs ?? []).length === 0 ? (
          <p className="px-4 py-6 text-sm text-destructive">{loadError}</p>
        ) : loading ? (
          <div className="flex flex-col gap-2 px-4 py-4">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : (runs ?? []).length === 0 && isFiltered ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              No recordings match these filters.
            </p>
            {streamKey && knownStreamKeys.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Stream key is an exact match. This device has recorded:{" "}
                {knownStreamKeys.map((k, i) => (
                  <span key={k}>
                    {i > 0 ? ", " : ""}
                    <button
                      type="button"
                      className="font-mono underline underline-offset-2 hover:text-foreground"
                      onClick={() =>
                        update({ streamKey: k, page: undefined })
                      }
                    >
                      {k}
                    </button>
                  </span>
                ))}
              </p>
            ) : null}
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        ) : (runs ?? []).length === 0 ? (
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
              {(runs ?? []).map((run) => {
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
        {/* Pagination counts RUNS — the noun the table renders (Phase 3).
            `total` is the server's run count over the whole filtered set, so
            every page but the last holds exactly `size` rows. */}
        {total > 0 ? (
          <div className="border-t border-border px-3 py-3">
            <DataTablePagination
              page={page}
              pageSize={size}
              total={total}
              rowsOnPage={(runs ?? []).length}
              pageSizes={SESSION_PAGE_SIZES}
              onPageChange={(p) => update({ page: p <= 1 ? undefined : p })}
              onPageSizeChange={(s) =>
                update({
                  size: s === DEFAULT_SESSION_PAGE_SIZE ? undefined : s,
                  page: undefined,
                })
              }
              onExportCsv={() => void exportCsv()}
              exporting={exporting}
              exportDisabled={total === 0}
              left={
                <span className="text-xs text-muted-foreground">
                  {(runs ?? []).length.toLocaleString()} run
                  {(runs ?? []).length === 1 ? "" : "s"} ·{" "}
                  {sessionsOnPage.toLocaleString()} session
                  {sessionsOnPage === 1 ? "" : "s"} on this page
                </span>
              }
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
