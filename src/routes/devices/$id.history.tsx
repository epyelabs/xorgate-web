import { useEffect, useMemo, useState } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  ApiError,
  getDevice,
  getDeviceModel,
  type IoCapabilities,
} from "@/lib/api"
import {
  getDeviceModelResponseSchema,
  getDeviceResponseSchema,
} from "@/lib/schemas"
import { imuMetrics, systemChartMetrics } from "@/lib/capability-metrics"
import { useAuthStore } from "@/store/auth"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import { useTelemetryHistory } from "@/hooks/use-telemetry-history"
import { TelemetryChart } from "@/components/telemetry-chart"
import { GpsTrackMap } from "@/components/gps-track-map"

interface HistorySearch {
  from?: string
  to?: string
}

export const Route = createFileRoute("/devices/$id/history")({
  validateSearch: (search: Record<string, unknown>): HistorySearch => ({
    from: typeof search.from === "string" ? search.from : undefined,
    to: typeof search.to === "string" ? search.to : undefined,
  }),
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DeviceHistoryPage,
})

const PRESETS: { label: string; ms: number }[] = [
  { label: "1h", ms: 60 * 60 * 1000 },
  { label: "6h", ms: 6 * 60 * 60 * 1000 },
  { label: "24h", ms: 24 * 60 * 60 * 1000 },
  { label: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
]

// ISO ↔ <input type="datetime-local"> (local time, minute precision)
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value: string): string | null {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

function DeviceHistoryPage() {
  const { id } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  // Stable default window (last hour at mount) so the fetch key doesn't churn.
  const [defaults] = useState(() => {
    const now = Date.now()
    return {
      from: new Date(now - 60 * 60 * 1000).toISOString(),
      to: new Date(now).toISOString(),
    }
  })
  const fromIso = search.from ?? defaults.from
  const toIso = search.to ?? defaults.to

  const [caps, setCaps] = useState<IoCapabilities | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Draft values for the datetime-local inputs (committed on Apply).
  const [draftFrom, setDraftFrom] = useState(() => toLocalInput(fromIso))
  const [draftTo, setDraftTo] = useState(() => toLocalInput(toIso))
  useEffect(() => {
    setDraftFrom(toLocalInput(fromIso))
    setDraftTo(toLocalInput(toIso))
  }, [fromIso, toIso])

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
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const imu = useMemo(() => imuMetrics(caps), [caps])
  const sysChart = useMemo(() => systemChartMetrics(caps), [caps])
  const hasGps = Boolean(caps?.comm?.gps)
  const metrics = useMemo(
    () => [...imu, ...sysChart, ...(hasGps ? ["gps.lat", "gps.lon"] : [])],
    [imu, sysChart, hasGps]
  )

  const { history, gpsTrack, loading, error, truncated } = useTelemetryHistory(
    id,
    fromIso,
    toIso,
    metrics
  )

  const setRange = (from: string, to: string) =>
    navigate({ search: { from, to } })

  const applyPreset = (ms: number) => {
    const now = Date.now()
    setRange(new Date(now - ms).toISOString(), new Date(now).toISOString())
  }

  const applyDraft = () => {
    const from = fromLocalInput(draftFrom)
    const to = fromLocalInput(draftTo)
    if (!from || !to) {
      toast.error("Enter valid dates")
      return
    }
    if (Date.parse(from) >= Date.parse(to)) {
      toast.error("From must be earlier than To")
      return
    }
    setRange(from, to)
  }

  return (
    <div className="flex flex-col gap-4">
      {loadError ? <p className="text-destructive text-sm">{loadError}</p> : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Time range</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <Button
                key={p.label}
                variant="outline"
                size="sm"
                onClick={() => applyPreset(p.ms)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-muted-foreground flex flex-col gap-1 text-xs">
              From
              <Input
                type="datetime-local"
                value={draftFrom}
                onChange={(e) => setDraftFrom(e.target.value)}
                className="h-8 w-fit"
              />
            </label>
            <label className="text-muted-foreground flex flex-col gap-1 text-xs">
              To
              <Input
                type="datetime-local"
                value={draftTo}
                onChange={(e) => setDraftTo(e.target.value)}
                className="h-8 w-fit"
              />
            </label>
            <Button size="sm" onClick={applyDraft}>
              Apply
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {truncated ? (
        <p className="text-muted-foreground text-sm">
          Result was truncated — narrow the time range for full resolution.
        </p>
      ) : null}
      {loading ? (
        <p className="text-muted-foreground text-sm">Loading telemetry…</p>
      ) : null}
      {!loading && !error && history.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No telemetry in this range.
        </p>
      ) : null}

      {history.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {imu.length > 0 ? (
            <TelemetryChart
              title="IMU acceleration"
              history={history}
              metrics={imu}
            />
          ) : null}
          {sysChart.length > 0 ? (
            <TelemetryChart title="System" history={history} metrics={sysChart} />
          ) : null}
        </div>
      ) : null}

      {hasGps && gpsTrack.length >= 2 ? <GpsTrackMap track={gpsTrack} /> : null}
    </div>
  )
}
