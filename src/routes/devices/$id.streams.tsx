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
  gpsMetrics,
  imuMetrics,
  signalMetrics,
  systemMetrics,
} from "@/lib/capability-metrics"
import { useIotTelemetry } from "@/hooks/use-iot-telemetry"
import { Separator } from "@/components/ui/separator"
import { TelemetryReadout } from "@/components/telemetry-readout"
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
  const { latest, status, error: connError } = useIotTelemetry(id)

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

  const videoCaps = caps?.media?.video ?? []
  const telemetryGroups = [
    { title: "IMU", metrics: imuMetrics(caps) },
    { title: "System", metrics: systemMetrics(caps) },
    { title: "Signal", metrics: signalMetrics(caps) },
  ].filter((g) => g.metrics.length > 0)
  const gps = gpsMetrics(caps)

  return (
    <div className="flex flex-col gap-6">
      {status === "error" && connError ? (
        <p className="text-sm text-destructive">{connError}</p>
      ) : null}
      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : null}

      {videoCaps.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold tracking-tight">Media</h2>
          <LiveVideoGrid deviceId={id} videoCaps={videoCaps} />
        </section>
      ) : null}

      {telemetryGroups.length > 0 ? (
        <>
          <Separator />
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold tracking-tight">Telemetry</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {telemetryGroups.map((g) => (
                <TelemetryReadout
                  key={g.title}
                  title={g.title}
                  latest={latest}
                  metrics={g.metrics}
                />
              ))}
            </div>
          </section>
        </>
      ) : null}

      {gps.length > 0 ? (
        <>
          <Separator />
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold tracking-tight">GPS / Location</h2>
            <div className="grid grid-cols-1 gap-4 md:max-w-md">
              <TelemetryReadout title="Position" latest={latest} metrics={gps} />
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
