import { useEffect, useState, type CSSProperties } from "react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { ArrowRightIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { TelemetryTable } from "@/components/telemetry-table"
import { useIotTelemetry } from "@/hooks/use-iot-telemetry"
import { useRecentTelemetry } from "@/hooks/use-recent-telemetry"
import { signalMetrics, systemMetrics } from "@/lib/capability-metrics"
import {
  formatMetricValue,
  formatUnit,
  metricLabel,
} from "@/lib/telemetry-meta"
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
import { useBreadcrumbStore } from "@/store/breadcrumb"

// The device Overview: a fast, at-a-glance landing dashboard assembled from the
// same hooks/components the deeper tabs use. It deliberately does NOT mount the
// live WebRTC grid (that stays on Active Streams) so opening a device is cheap.
export const Route = createFileRoute("/devices/$id/overview")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DeviceOverviewPage,
})

const RECENT_TELEMETRY_ROWS = 10

function DeviceOverviewPage() {
  const { id } = Route.useParams()
  const { latest } = useIotTelemetry(id)

  const [device, setDevice] = useState<Device | null>(null)
  const [caps, setCaps] = useState<IoCapabilities | null>(null)
  const [metaLoading, setMetaLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Device + model (drives the live health tiles the model's caps allow).
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
        const fetched = parsedDevice.data.device
        setDevice(fetched)
        useBreadcrumbStore
          .getState()
          .setDeviceName(fetched.name ?? fetched.serial)

        const rawModel = await getDeviceModel(fetched.deviceModelId)
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
        if (!cancelled) setMetaLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  // Recent recorded telemetry: fetch whatever the DB has, once. No time window
  // and no metric filter, so the newest stored samples show up even if the
  // device last reported weeks ago.
  const {
    history: recordedHistory,
    metrics: recordedMetrics,
    units: recordedUnits,
    loading: recordedLoading,
  } = useRecentTelemetry(id)

  const isOnline = device?.status === "online"
  const sysMetrics = systemMetrics(caps)
  const sigMetrics = signalMetrics(caps)
  const healthMetrics = [...sysMetrics, ...sigMetrics]
  // Show only the newest few rows on the Overview; "View all" opens the full
  // Telemetry History tab. history is ascending, so the tail is the most recent.
  const recentTelemetry = recordedHistory.slice(-RECENT_TELEMETRY_ROWS)

  const telemetryViewAll = (
    <Button asChild variant="outline" size="sm">
      <Link to="/devices/$id/telemetry" params={{ id }}>
        View all
        <ArrowRightIcon />
      </Link>
    </Button>
  )

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : null}

      {/* Live health snapshot — compact metric tiles in a single card */}
      {metaLoading ? (
        <Card size="sm">
          <CardContent>
            <div className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <Skeleton className="h-2.5 w-14" />
                  <Skeleton className="h-4 w-10" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : healthMetrics.length > 0 ? (
        <Card size="sm">
          <CardContent>
            {/* One column per metric at lg+ so the whole health snapshot sits on
                a single row (the card is full-width, unlike the Map View's
                side-column panel); wraps below lg where there isn't room. */}
            <div
              className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-4 lg:[grid-template-columns:repeat(var(--metric-cols),minmax(0,1fr))]"
              style={
                { "--metric-cols": healthMetrics.length } as CSSProperties
              }
            >
              {healthMetrics.map((m) => {
                const r = latest[m]
                return (
                  <div key={m} className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[10px] tracking-wide text-muted-foreground uppercase">
                      {metricLabel(m)}
                    </span>
                    <span className="text-sm font-medium tabular-nums">
                      {r ? formatMetricValue(r.value, m) : "—"}
                      {r?.unit ? (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          {formatUnit(r.unit)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                )
              })}
            </div>
            {!isOnline ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Device offline. No live telemetry.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Recent recorded telemetry — the title + "View all" sit in a header row
          above a standalone table card (matching the Workflows tab), not inside
          the card header. */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 className="font-heading text-sm font-medium">
              Recent recorded telemetry
            </h2>
          </div>
          {telemetryViewAll}
        </div>
        <TelemetryTable
          history={recentTelemetry}
          metrics={recordedMetrics}
          units={recordedUnits}
          pinFirstColumn
          loading={recordedLoading}
          empty={
            <p className="py-6 text-center text-sm text-muted-foreground">
              No recorded telemetry yet.
            </p>
          }
        />
      </section>

      {/* The "Recent media recordings" section that sat here rendered the cloud
          recorder's table and went with it. Phase 2 of the recorder-removal plan
          refills this slot with a compact recent ON-DEVICE sessions list. */}
    </div>
  )
}
