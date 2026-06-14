import { useEffect, useState } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { toast } from "sonner"
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
import { useAuthStore } from "@/store/auth"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import {
  gaugeMetrics,
  imuMetrics,
  systemChartMetrics,
} from "@/lib/capability-metrics"
import { useIotTelemetry } from "@/hooks/use-iot-telemetry"
import { TelemetryGauges } from "@/components/telemetry-gauges"
import { TelemetryChart } from "@/components/telemetry-chart"
import { GpsMap } from "@/components/gps-map"
import { LiveVideoGrid } from "@/components/live-video-grid"

export const Route = createFileRoute("/devices/$id/streams")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DeviceStreamsPage,
})

function DeviceStreamsPage() {
  const { id } = Route.useParams()
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

  const gauges = gaugeMetrics(caps)
  const imu = imuMetrics(caps)
  const sysChart = systemChartMetrics(caps)
  const hasGps = Boolean(caps?.comm?.gps)
  const videoCaps = caps?.media?.video ?? []
  const gpsLat = latest["gps.lat"]?.value
  const gpsLon = latest["gps.lon"]?.value

  return (
    <div className="flex flex-col gap-4">
      {status === "error" && connError ? (
        <p className="text-sm text-destructive">{connError}</p>
      ) : null}
      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : null}

      {videoCaps.length > 0 ? (
        <LiveVideoGrid deviceId={id} videoCaps={videoCaps} />
      ) : null}

      <TelemetryGauges latest={latest} metrics={gauges} />

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

      {hasGps ? (
        gpsLat !== undefined && gpsLon !== undefined ? (
          <GpsMap lat={gpsLat} lon={gpsLon} />
        ) : (
          <p className="text-sm text-muted-foreground">Waiting for GPS fix…</p>
        )
      ) : null}
    </div>
  )
}
