import { useEffect, useMemo, useState } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
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
import {
  ApiError,
  getDevice,
  getDeviceModel,
  getTelemetryReadings,
  type IoCapabilities,
} from "@/lib/api"
import {
  getDeviceModelResponseSchema,
  getDeviceResponseSchema,
} from "@/lib/schemas"
import { imuMetrics, systemChartMetrics } from "@/lib/capability-metrics"
import { metricLabel, orderMetrics } from "@/lib/telemetry-meta"
import { useAuthStore } from "@/store/auth"
import { useBreadcrumbStore } from "@/store/breadcrumb"
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
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
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

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
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

  const [caps, setCaps] = useState<IoCapabilities | null>(null)
  const [capsLoaded, setCapsLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [customOpen, setCustomOpen] = useState(false)
  const [pendingRange, setPendingRange] = useState<DateRange | undefined>(
    undefined
  )
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rawDevice = await getDevice(id)
        const parsedDevice = getDeviceResponseSchema.safeParse(rawDevice)
        if (!parsedDevice.success) {
          throw new Error("Unexpected /devices/:id response shape")
        }
        if (cancelled) return
        useBreadcrumbStore
          .getState()
          .setDeviceName(
            parsedDevice.data.device.name ?? parsedDevice.data.device.serial
          )

        const rawModel = await getDeviceModel(
          parsedDevice.data.device.deviceModelId
        )
        const parsedModel = getDeviceModelResponseSchema.safeParse(rawModel)
        if (parsedModel.success && !cancelled) {
          setCaps(parsedModel.data.device_model.ioCapabilities ?? null)
        }
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : (err as Error).message
        if (!cancelled) {
          setLoadError(message)
          toast.error(message)
        }
      } finally {
        if (!cancelled) setCapsLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const imu = useMemo(() => imuMetrics(caps), [caps])
  const sysChart = useMemo(() => systemChartMetrics(caps), [caps])
  const hasGps = Boolean(caps?.comm?.gps)
  // Capability-derived columns keep a stable, ordered column set (and double as
  // the server-side metric filter). If capabilities are unavailable we fall back
  // to whatever metrics the data itself surfaces.
  const capsMetrics = useMemo(
    () => [...imu, ...sysChart, ...(hasGps ? ["gps.lat", "gps.lon"] : [])],
    [imu, sysChart, hasGps]
  )
  const metricFilter = capsMetrics.length ? capsMetrics.join(",") : undefined

  const {
    history,
    metrics: discovered,
    units,
    total,
    loading,
    error,
  } = useTelemetryReadings(id, {
    from: fromIso,
    to: toIso,
    order,
    limit: size,
    offset,
    metric: metricFilter,
    enabled: capsLoaded,
  })

  const columns = capsMetrics.length ? capsMetrics : discovered

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

  // Export every reading matching the current filter (paging through the API),
  // pivoted to one row per timestamp. Capped so an unbounded "All" export can't
  // run away; the user is warned when the cap is hit.
  const exportCsv = async () => {
    if (total === 0) {
      toast.error("Nothing to export")
      return
    }
    setExporting(true)
    try {
      const EXPORT_CAP = 20000
      const pageLimit = 500
      const byTs = new Map<number, Record<string, number>>()
      const exportUnits: Record<string, string> = {}
      const seen = new Set<string>()
      let off = 0
      let grandTotal = Infinity
      let capped = false
      while (off < grandTotal) {
        const res = await getTelemetryReadings(id, {
          from: fromIso,
          to: toIso,
          order,
          metric: metricFilter,
          limit: pageLimit,
          offset: off,
        })
        grandTotal = res.page.total
        for (const r of res.readings) {
          if (r.value === null) continue
          const ts = Date.parse(r.ts)
          let pt = byTs.get(ts)
          if (!pt) {
            pt = {}
            byTs.set(ts, pt)
          }
          pt[r.metric] = r.value
          seen.add(r.metric)
          if (r.unit && !(r.metric in exportUnits)) exportUnits[r.metric] = r.unit
        }
        if (res.readings.length === 0) break
        off += pageLimit
        if (byTs.size >= EXPORT_CAP) {
          capped = true
          break
        }
      }

      const cols = capsMetrics.length ? capsMetrics : orderMetrics([...seen])
      const tsList = [...byTs.keys()].sort((a, b) =>
        order === "asc" ? a - b : b - a
      )
      const header = [
        "Time",
        ...cols.map(
          (m) => metricLabel(m) + (exportUnits[m] ? ` (${exportUnits[m]})` : "")
        ),
      ]
      const lines = [header.map(csvCell).join(",")]
      for (const ts of tsList) {
        const pt = byTs.get(ts)!
        const row = [
          new Date(ts).toISOString(),
          ...cols.map((m) => (typeof pt[m] === "number" ? String(pt[m]) : "")),
        ]
        lines.push(row.map(csvCell).join(","))
      }
      downloadCsv(lines.join("\n"), `telemetry-${id}.csv`)
      if (capped) {
        toast.warning(
          `Export capped at ${EXPORT_CAP.toLocaleString()} rows. Narrow the range for a complete export.`
        )
      }
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : (err as Error).message
      toast.error(`Export failed: ${message}`)
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
  const hasPrev = page > 1
  const hasNext = page < totalPages

  const rowsOnPage = history.length
  const startIdx = total === 0 ? 0 : offset + 1
  const endIdx = offset + rowsOnPage

  const customActive = rangeMode === "custom"
  const customLabel =
    customActive && search.from && search.to
      ? rangeLabel(search.from, search.to)
      : "Date"

  const toolbar = (
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
  )

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        onClick={exportCsv}
        disabled={exporting || !capsLoaded || total === 0}
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
            {startIdx.toLocaleString()}–{endIdx.toLocaleString()} of{" "}
            {total.toLocaleString()}
          </span>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={!hasPrev || loading}
            onClick={() => goTo(page - 1)}
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
      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : null}

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
          loading={!capsLoaded || (loading && history.length === 0)}
          empty={
            <p className="text-sm text-muted-foreground">
              {rangeMode === "all"
                ? "No telemetry recorded for this device yet."
                : "No telemetry in this range."}
            </p>
          }
        />
      </div>
    </div>
  )
}
