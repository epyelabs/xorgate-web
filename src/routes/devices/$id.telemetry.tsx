import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { requireWorkspace } from "@/lib/auth-guard"
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
} from "lucide-react"
import { type DateRange } from "react-day-picker"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { xg, xgMessage } from "@/lib/xorgate"
import {
  buildTelemetryCsv,
  collectTelemetryForExport,
} from "@/lib/telemetry-export"
import { useTelemetryReadings } from "@/hooks/use-telemetry-readings"
import { TelemetryTable } from "@/components/telemetry-table"

type RangeMode = "all" | "1h" | "6h" | "24h" | "7d" | "custom"
type Order = "asc" | "desc"

interface HistorySearch {
  from?: string
  to?: string
  range?: RangeMode
  order?: Order
  page?: number
  size?: number
}

const RANGE_MODES: RangeMode[] = ["all", "1h", "6h", "24h", "7d", "custom"]
const PAGE_SIZES = [25, 50, 100, 200]
const DEFAULT_SIZE = 100
const DAY_MS = 24 * 60 * 60 * 1000

const PRESETS: { label: string; mode: RangeMode; ms: number }[] = [
  { label: "1h", mode: "1h", ms: 60 * 60 * 1000 },
  { label: "6h", mode: "6h", ms: 6 * 60 * 60 * 1000 },
  { label: "24h", mode: "24h", ms: DAY_MS },
  { label: "7d", mode: "7d", ms: 7 * DAY_MS },
]

const shortDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
})

// "Aug 3, 19:01" — the covered span is read alongside a date, so the year is
// noise and the seconds are below the resolution of the sentence.
const spanStamp = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

// The covered span reads as one period, so drop the repeated date when both
// ends fall on the same day: "Aug 3, 19:01 – 21:48".
function coveredSpanLabel(fromIso: string, toIso: string): string {
  const from = new Date(fromIso)
  const to = new Date(toIso)
  const sameDay = from.toDateString() === to.toDateString()
  return `${spanStamp.format(from)} – ${
    sameDay
      ? to.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : spanStamp.format(to)
  }`
}

export const Route = createFileRoute("/devices/$id/telemetry")({
  validateSearch: (search: Record<string, unknown>): HistorySearch => {
    const range = RANGE_MODES.includes(search.range as RangeMode)
      ? (search.range as RangeMode)
      : undefined
    const order =
      search.order === "asc" ? "asc" : search.order === "desc" ? "desc" : undefined
    const pageNum = Number(search.page)
    const page = Number.isInteger(pageNum) && pageNum > 1 ? pageNum : undefined
    const sizeNum = Number(search.size)
    const size = PAGE_SIZES.includes(sizeNum) ? sizeNum : undefined
    return {
      from: typeof search.from === "string" ? search.from : undefined,
      to: typeof search.to === "string" ? search.to : undefined,
      range,
      order,
      page,
      size,
    }
  },
  beforeLoad: requireWorkspace,
  component: DeviceTelemetryPage,
})

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

// Custom windows are stored as [startOfDay(from), startOfDay(to)+1day) so the
// picked end date is inclusive. Reconstruct the inclusive dates for display and
// for re-seeding the calendar.
function rangeLabel(fromIso: string, toIso: string): string {
  const from = new Date(fromIso)
  const toIncl = new Date(Date.parse(toIso) - 1)
  const f = shortDate.format(from)
  const t = shortDate.format(toIncl)
  return f === t ? f : `${f} – ${t}`
}

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function DeviceTelemetryPage() {
  const { id } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  const rangeMode: RangeMode = search.range ?? "all"
  const order: Order = search.order ?? "desc"
  const size = search.size ?? DEFAULT_SIZE
  const page = search.page ?? 1
  const offset = (page - 1) * size

  // Effective time window: "all" ignores from/to (shows the latest samples).
  const fromIso = rangeMode === "all" ? undefined : search.from
  const toIso = rangeMode === "all" ? undefined : search.to

  const [customOpen, setCustomOpen] = useState(false)
  const [pendingRange, setPendingRange] = useState<DateRange | undefined>(
    undefined
  )
  const [exporting, setExporting] = useState(false)

  // The server assembles the table: columns, their order and their units all
  // come back with the page, so this renders after ONE request. It used to walk
  // getDevice → getDeviceModel → readings to derive the column set itself, and
  // the breadcrumb name it set on the way is already set by the parent layout
  // route ($id.tsx), which owns the device fetch.
  const {
    history,
    metrics: columns,
    units,
    total,
    totalIsCapped,
    coveredFrom,
    coveredTo,
    loading,
    error,
  } = useTelemetryReadings(id, {
    from: fromIso,
    to: toIso,
    order,
    limit: size,
    offset,
  })

  const update = (patch: Partial<HistorySearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }) })

  const applyPreset = (mode: RangeMode, ms: number) => {
    const now = Date.now()
    update({
      range: mode,
      from: new Date(now - ms).toISOString(),
      to: new Date(now).toISOString(),
      page: undefined,
    })
  }

  const applyAll = () =>
    update({ range: "all", from: undefined, to: undefined, page: undefined })

  const openCustom = (open: boolean) => {
    if (open) {
      setPendingRange(
        search.from && search.to
          ? {
              from: new Date(search.from),
              to: new Date(Date.parse(search.to) - 1),
            }
          : undefined
      )
    }
    setCustomOpen(open)
  }

  const selectRange = (r: DateRange | undefined) => {
    setPendingRange(r)
    if (r?.from && r?.to) {
      const from = startOfDay(r.from)
      const toExcl = new Date(startOfDay(r.to).getTime() + DAY_MS)
      update({
        range: "custom",
        from: from.toISOString(),
        to: toExcl.toISOString(),
        page: undefined,
      })
      setCustomOpen(false)
    }
  }

  const toggleSort = () =>
    update({ order: order === "asc" ? "desc" : "asc", page: undefined })

  const setSize = (s: number) =>
    update({ size: s === DEFAULT_SIZE ? undefined : s, page: undefined })

  // Export every sample matching the current filter, pivoted to one row per
  // timestamp. The walk pages by TIME rather than by `offset` — see
  // lib/telemetry-export.ts for why that matters (the server's `total` is capped
  // at 10 000, and offset paging also loses rows to the 1 Hz sliding window).
  // Bounded at TELEMETRY_EXPORT_CAP rows, and the user is told when it binds.
  const exportCsv = async () => {
    if (total === 0) {
      toast.error("Nothing to export")
      return
    }
    setExporting(true)
    try {
      const result = await collectTelemetryForExport(
        (params) => xg().telemetry.readings(id, params),
        { order, from: fromIso, to: toIso }
      )
      const csv = buildTelemetryCsv(result, columns)
      downloadCsv(csv, `telemetry-${id}.csv`)
      if (result.capped) {
        toast.warning(
          `Export capped at ${result.points.length.toLocaleString()} rows. Narrow the date range for a complete export.`
        )
      }
    } catch (err) {
      toast.error(`Export failed: ${xgMessage(err)}`)
    } finally {
      setExporting(false)
    }
  }

  const presetChips: { key: RangeMode; label: string; onClick: () => void }[] = [
    { key: "all", label: "All", onClick: applyAll },
    ...PRESETS.map((p) => ({
      key: p.mode,
      label: p.label,
      onClick: () => applyPreset(p.mode, p.ms),
    })),
  ]

  const totalPages = Math.max(1, Math.ceil(total / size))
  const goTo = (p: number) => update({ page: p <= 1 ? undefined : p })
  // A bookmarked ?page= can point past the addressable window (which shrinks as
  // the range narrows, and is capped at 10 000 regardless). The page renders
  // empty and correct; Prev then jumps back to the last real page rather than
  // walking one empty page at a time.
  const beyondEnd = total > 0 && offset >= total
  const hasPrev = page > 1
  const hasNext = page < totalPages

  const rowsOnPage = history.length
  // ⚠ Clamp against `total`. Without it ?page=5000 rendered "499,901–499,900 of
  // 10,000" — a backwards range, because endIdx was offset + rowsOnPage with
  // rowsOnPage = 0.
  const startIdx = rowsOnPage === 0 ? 0 : Math.min(offset + 1, total)
  const endIdx = Math.min(offset + rowsOnPage, total)

  // ⚠ The capped view is the COMMON case, not an edge case: at 1 Hz a day is
  // ~86 400 samples, so All, 7d, 24h and 6h all cap and only 1h comes back
  // exact. A bare "10,000+" would tell a user who asked for "All" nothing about
  // the fact that they are looking at a slice — so render the span the server
  // measured. Never derive it from the cap: how long 10 000 samples covers
  // depends entirely on how densely the device reported (measured between
  // ~2 h 47 min and ~13 h 20 min on the same device, a day apart).
  const cappedNotice =
    totalIsCapped && coveredFrom && coveredTo
      ? `${order === "desc" ? "Most recent" : "Oldest"} ${total.toLocaleString()} samples · ${coveredSpanLabel(coveredFrom, coveredTo)}`
      : null

  const customActive = rangeMode === "custom"
  const customLabel =
    customActive && search.from && search.to
      ? rangeLabel(search.from, search.to)
      : "Date"

  const toolbar = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
      <Popover open={customOpen} onOpenChange={openCustom}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={customActive ? "default" : "outline"}
            size="sm"
            className="h-7 gap-1.5 px-2.5"
          >
            <CalendarIcon className="size-3.5" />
            {customLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            numberOfMonths={2}
            defaultMonth={pendingRange?.from}
            selected={pendingRange}
            onSelect={selectRange}
            autoFocus
          />
        </PopoverContent>
      </Popover>

      <div className="flex flex-wrap items-center gap-1">
        {presetChips.map((c) => (
          <Button
            key={c.key}
            type="button"
            variant={rangeMode === c.key ? "default" : "outline"}
            size="sm"
            className="h-7 px-2.5"
            onClick={c.onClick}
          >
            {c.label}
          </Button>
        ))}
      </div>
      </div>

      {cappedNotice ? (
        <p className="text-xs text-muted-foreground">
          {cappedNotice} —{" "}
          <span className="text-foreground/70">
            narrow the date range to see older data
          </span>
        </p>
      ) : null}
    </div>
  )

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        onClick={exportCsv}
        disabled={exporting || total === 0}
      >
        <DownloadIcon className="size-3.5" />
        {exporting ? "Exporting…" : "Export CSV"}
      </Button>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Rows</span>
          <Select value={String(size)} onValueChange={(v) => setSize(Number(v))}>
            <SelectTrigger className="h-8 w-[74px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {total > 0 ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {beyondEnd ? (
              <>Past the last page of {total.toLocaleString()}</>
            ) : (
              <>
                {startIdx.toLocaleString()}–{endIdx.toLocaleString()} of{" "}
                {total.toLocaleString()}
                {totalIsCapped ? "+" : null}
              </>
            )}
          </span>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={!hasPrev || loading}
            onClick={() => goTo(beyondEnd ? totalPages : page - 1)}
          >
            <ChevronLeftIcon />
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={!hasNext || loading}
            onClick={() => goTo(page + 1)}
          >
            Next
            <ChevronRightIcon />
          </Button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex min-h-0 flex-1 flex-col">
        <TelemetryTable
          history={history}
          metrics={columns}
          units={units}
          sortDir={order}
          onToggleSort={toggleSort}
          pinFirstColumn
          fillHeight
          toolbar={toolbar}
          footer={footer}
          loading={loading && history.length === 0}
          empty={
            // Telemetry history is opt-in: only the on-device recorder writes it
            // (disable_telemetry_recording, 2026-08-04), and it defaults to off.
            // So an empty All range usually means the setting is off, not that
            // data is still on its way — name the setting instead of saying "yet".
            <p className="text-sm text-muted-foreground">
              {rangeMode === "all"
                ? "No telemetry history. Turn on “Record telemetry on device” in Settings to start recording."
                : "No telemetry in this range."}
            </p>
          }
        />
      </div>
    </div>
  )
}
