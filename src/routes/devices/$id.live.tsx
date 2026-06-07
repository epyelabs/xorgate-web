import { useEffect, useState } from "react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import {
  ApiError,
  getDevice,
  getDeviceModel,
  type Device,
  type IoCapabilities,
} from "@/lib/api"
import {
  getDeviceModelResponseSchema,
  getDeviceResponseSchema,
} from "@/lib/schemas"
import { useAuthStore } from "@/store/auth"
import { useIotTelemetry, type ConnStatus } from "@/hooks/use-iot-telemetry"
import { TelemetryGauges } from "@/components/telemetry-gauges"
import { TelemetryChart } from "@/components/telemetry-chart"
import { GpsMap } from "@/components/gps-map"

export const Route = createFileRoute("/devices/$id/live")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DeviceLivePage,
})

// --- capability → metric-key helpers (drives which widgets render) ---
function gaugeMetrics(caps: IoCapabilities | null): string[] {
  if (!caps) return []
  const m: string[] = []
  for (const f of caps.system?.fields ?? []) m.push(`system.${f}`)
  for (const f of caps.comm?.signal?.fields ?? []) m.push(`lte.${f}`)
  const gps = caps.comm?.gps?.fields ?? []
  if (gps.includes("speed")) m.push("gps.speed")
  if (gps.includes("alt")) m.push("gps.alt")
  return m
}

function imuMetrics(caps: IoCapabilities | null): string[] {
  const axes = caps?.sensors?.imu?.axes
  if (!axes || axes.length === 0) return []
  return axes.map((a) => `imu.${a}`)
}

function systemChartMetrics(caps: IoCapabilities | null): string[] {
  return (caps?.system?.fields ?? [])
    .filter((f) => f === "cpu_usage" || f === "ram_usage" || f === "cpu_temp")
    .map((f) => `system.${f}`)
}

const STATUS_META: Record<
  ConnStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  connecting: { label: "Connecting", variant: "secondary" },
  connected: { label: "Live", variant: "default" },
  closed: { label: "Reconnecting", variant: "outline" },
  error: { label: "Error", variant: "destructive" },
}

function DeviceLivePage() {
  const { id } = Route.useParams()
  const [device, setDevice] = useState<Device | null>(null)
  const [caps, setCaps] = useState<IoCapabilities | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const { latest, history, status, error: connError } = useIotTelemetry(id)

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
        setDevice(parsedDevice.data.device)

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

  const gauges = gaugeMetrics(caps)
  const imu = imuMetrics(caps)
  const sysChart = systemChartMetrics(caps)
  const hasGps = Boolean(caps?.comm?.gps)
  const gpsLat = latest["gps.lat"]?.value
  const gpsLon = latest["gps.lon"]?.value

  const statusMeta = STATUS_META[status]

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-center justify-between">
        <Link
          to="/devices/$id"
          params={{ id }}
          className="text-muted-foreground hover:text-foreground text-xs"
        >
          ← Back to device
        </Link>
        <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
      </div>

      <div>
        <h1 className="text-lg font-semibold">
          {device?.name ?? device?.serial ?? "Device"} — Live telemetry
        </h1>
        <p className="text-muted-foreground text-xs">{id}</p>
      </div>

      {status === "error" && connError ? (
        <p className="text-destructive text-sm">{connError}</p>
      ) : null}
      {loadError ? <p className="text-destructive text-sm">{loadError}</p> : null}

      <TelemetryGauges latest={latest} metrics={gauges} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {imu.length > 0 ? (
          <TelemetryChart title="IMU acceleration" history={history} metrics={imu} />
        ) : null}
        {sysChart.length > 0 ? (
          <TelemetryChart title="System" history={history} metrics={sysChart} />
        ) : null}
      </div>

      {hasGps ? (
        gpsLat !== undefined && gpsLon !== undefined ? (
          <GpsMap lat={gpsLat} lon={gpsLon} />
        ) : (
          <p className="text-muted-foreground text-sm">Waiting for GPS fix…</p>
        )
      ) : null}
    </div>
  )
}
