import { useCallback, useEffect, useState } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { ChevronDownIcon, FilterIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  DataTableToolbar,
  DateRangeFilter,
  type DateRangeMode,
} from "@/components/data-table"
import {
  getDeviceRecordings,
  type Recording,
  type RecordingStatus,
} from "@/lib/api"
import { getDeviceRecordingsResponseSchema } from "@/lib/schemas"
import { useAuthStore } from "@/store/auth"
import { RecordingsTable } from "./-components/recordings-table"
import { DeviceSessionsCard } from "./-components/device-sessions-card"

type Order = "asc" | "desc"
type SortKey = "startedAt" | "durationMs" | "sizeBytes"

const PAGE_SIZES = [25, 50, 100, 200]
const DEFAULT_SIZE = 50
const SORT_KEYS: SortKey[] = ["startedAt", "durationMs", "sizeBytes"]
const RANGE_MODES: DateRangeMode[] = ["all", "1h", "6h", "24h", "7d", "custom"]
const RECORDING_STATUSES: RecordingStatus[] = [
  "recording",
  "stopping",
  "completed",
  "failed",
]
const STATUS_OPTIONS: readonly (RecordingStatus | "any")[] = [
  "any",
  ...RECORDING_STATUSES,
]
const POLL_MS = 5000
const EXPORT_CAP = 5000

interface MediaSearch {
  page?: number
  size?: number
  order?: Order
  sort?: SortKey
  status?: RecordingStatus // omitted => "any"
  range?: DateRangeMode
  from?: string
  to?: string
}

export const Route = createFileRoute("/devices/$id/media")({
  validateSearch: (search: Record<string, unknown>): MediaSearch => {
    const sizeNum = Number(search.size)
    const size = PAGE_SIZES.includes(sizeNum) ? sizeNum : undefined
    const pageNum = Number(search.page)
    const page = Number.isInteger(pageNum) && pageNum > 1 ? pageNum : undefined
    const order =
      search.order === "asc" ? "asc" : search.order === "desc" ? "desc" : undefined
    const sort = SORT_KEYS.includes(search.sort as SortKey)
      ? (search.sort as SortKey)
      : undefined
    const status = RECORDING_STATUSES.includes(search.status as RecordingStatus)
      ? (search.status as RecordingStatus)
      : undefined
    const range = RANGE_MODES.includes(search.range as DateRangeMode)
      ? (search.range as DateRangeMode)
      : undefined
    return {
      page,
      size,
      order,
      sort,
      status,
      range,
      from: typeof search.from === "string" ? search.from : undefined,
      to: typeof search.to === "string" ? search.to : undefined,
    }
  },
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DeviceMediaPage,
})

function DeviceMediaPage() {
  const { id } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  const size = search.size ?? DEFAULT_SIZE
  const page = search.page ?? 1
  const offset = (page - 1) * size
  const order: Order = search.order ?? "desc"
  const sort: SortKey = search.sort ?? "startedAt"
  const status = search.status
  const rangeMode: DateRangeMode = search.range ?? "all"
  // "all" ignores from/to (shows the latest recordings).
  const fromIso = rangeMode === "all" ? undefined : search.from
  const toIso = rangeMode === "all" ? undefined : search.to

  const [data, setData] = useState<{ recordings: Recording[]; total: number } | null>(
    null
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  const refresh = useCallback(async () => {
    try {
      const raw = await getDeviceRecordings(id, {
        limit: size,
        offset,
        order,
        sort,
        status,
        from: fromIso,
        to: toIso,
      })
      const parsed = getDeviceRecordingsResponseSchema.safeParse(raw)
      if (!parsed.success) throw new Error("Unexpected recordings response")
      setData({
        recordings: parsed.data.recordings,
        total: parsed.data.page?.total ?? parsed.data.recordings.length,
      })
      setLoadError(null)
    } catch (err) {
      setLoadError((err as Error).message)
    }
  }, [id, size, offset, order, sort, status, fromIso, toIso])

  // Poll while mounted so statuses/sizes stay current (e.g. recording -> completed).
  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  const update = (patch: Partial<MediaSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }) })

  const onToggleSort = (columnId: string) => {
    const key = columnId as SortKey
    if (key === sort) {
      update({ order: order === "asc" ? "desc" : "asc", page: undefined })
    } else {
      update({ sort: key, order: "desc", page: undefined })
    }
  }

  const setSize = (s: number) =>
    update({ size: s === DEFAULT_SIZE ? undefined : s, page: undefined })
  const goTo = (p: number) => update({ page: p <= 1 ? undefined : p })
  const setStatus = (s: RecordingStatus | "any") =>
    update({ status: s === "any" ? undefined : s, page: undefined })

  const recordings = data?.recordings ?? []
  const total = data?.total ?? 0
  const loading = data === null

  // Client-side stream-key search over the current page.
  const q = query.trim().toLowerCase()
  const visible = q
    ? recordings.filter((r) => r.streamKey.toLowerCase().includes(q))
    : recordings
  const isFiltered = q !== "" || status !== undefined || rangeMode !== "all"

  // Fetch every recording matching the current server filters (paged), then apply
  // the client search — the table's standard Export CSV calls this.
  const getExportRows = async (): Promise<Recording[]> => {
    const pageLimit = 200
    const all: Recording[] = []
    let off = 0
    let grandTotal = Infinity
    while (off < grandTotal && all.length < EXPORT_CAP) {
      const raw = await getDeviceRecordings(id, {
        limit: pageLimit,
        offset: off,
        order,
        sort,
        status,
        from: fromIso,
        to: toIso,
      })
      const parsed = getDeviceRecordingsResponseSchema.safeParse(raw)
      if (!parsed.success) break
      all.push(...parsed.data.recordings)
      grandTotal = parsed.data.page?.total ?? parsed.data.recordings.length
      if (parsed.data.recordings.length === 0) break
      off += pageLimit
    }
    return q ? all.filter((r) => r.streamKey.toLowerCase().includes(q)) : all
  }

  const statusFilter = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7">
          <FilterIcon />
          status: {status ?? "any"}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {STATUS_OPTIONS.map((opt) => (
          <DropdownMenuItem key={opt} onSelect={() => setStatus(opt)}>
            {opt}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="flex flex-col gap-4">
      {loadError && recordings.length === 0 ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : (
        <RecordingsTable
          card
          deviceId={id}
          recordings={visible}
          onChanged={refresh}
          sort={{ columnId: sort, dir: order }}
          onToggleSort={onToggleSort}
          loading={loading}
          isFiltered={isFiltered}
          filteredEmptyMessage="No recordings match these filters."
          toolbar={
            <DataTableToolbar
              filters={
                <>
                  <DateRangeFilter
                    value={{ mode: rangeMode, from: search.from, to: search.to }}
                    onChange={(v) =>
                      update({
                        range: v.mode,
                        from: v.from,
                        to: v.to,
                        page: undefined,
                      })
                    }
                  />
                  {statusFilter}
                </>
              }
              search={{
                value: query,
                onChange: setQuery,
                placeholder: "Filter by stream…",
              }}
              searchAlign="right"
            />
          }
          pagination={{
            page,
            pageSize: size,
            total,
            rowsOnPage: visible.length,
            pageSizes: PAGE_SIZES,
            onPageChange: goTo,
            onPageSizeChange: setSize,
          }}
          exportCsv={{
            filename: `recordings-${id}.csv`,
            getRows: getExportRows,
          }}
        />
      )}

      {/* Device-recorded sessions (offline recording plan) — a separate source
          from the cloud recordings above, so it gets its own card. */}
      <DeviceSessionsCard deviceId={id} />
    </div>
  )
}
