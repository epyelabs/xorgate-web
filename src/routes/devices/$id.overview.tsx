import { useCallback, useEffect, useState } from "react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { ArrowRightIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { TelemetryTable } from "@/components/telemetry-table"
import { useIotTelemetry } from "@/hooks/use-iot-telemetry"
import { useRecentTelemetry } from "@/hooks/use-recent-telemetry"
import { signalMetrics, systemMetrics } from "@/lib/capability-metrics"
import { formatMetricValue, metricLabel } from "@/lib/telemetry-meta"
import {
  ApiError,
  getDevice,
  getDeviceModel,
  getDeviceRecordings,
  type Device,
  type IoCapabilities,
  type Recording,
} from "@/lib/api"
import {
  getDeviceModelResponseSchema,
  getDeviceRecordingsResponseSchema,
  getDeviceResponseSchema,
} from "@/lib/schemas"
import { useAuthStore } from "@/store/auth"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import { RecordingsTable } from "./-components/recordings-table"

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

const RECENT_RECORDINGS = 5
const RECENT_TELEMETRY_ROWS = 10

function DeviceOverviewPage() {
  const { id } = Route.useParams()
  const { latest } = useIotTelemetry(id)

  const [device, setDevice] = useState<Device | null>(null)
  const [caps, setCaps] = useState<IoCapabilities | null>(null)
  const [metaLoading, setMetaLoading] = useState(true)
  const [recordings, setRecordings] = useState<Recording[] | null>(null)
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

  // Recent recordings (best-effort): the latest few for the summary list.
  const loadRecordings = useCallback(async () => {
    try {
      const raw = await getDeviceRecordings(id)
      const parsed = getDeviceRecordingsResponseSchema.safeParse(raw)
      if (parsed.success) setRecordings(parsed.data.recordings)
      else setRecordings([])
    } catch {
      setRecordings([])
    }
  }, [id])

  useEffect(() => {
    // Wrap in an async IIFE (matching the streams/settings tabs) so the mount
    // load doesn't read as a synchronous setState in the effect body.
    ;(async () => {
      await loadRecordings()
    })()
  }, [loadRecordings])

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
  const persistOff = Boolean(device && !device.persistTelemetry)
  // Show only the newest few rows on the Overview; "View all" opens the full
  // Telemetry History tab. history is ascending, so the tail is the most recent.
  const recentTelemetry = recordedHistory.slice(-RECENT_TELEMETRY_ROWS)
  const recentRecordings = (recordings ?? [])
    .slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, RECENT_RECORDINGS)

  const telemetryViewAll = (
    <Button asChild variant="outline" size="sm">
      <Link to="/devices/$id/telemetry" params={{ id }}>
        View all
        <ArrowRightIcon />
      </Link>
    </Button>
  )

  const persistNotice = persistOff ? (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">
        Persist telemetry is off.
      </span>{" "}
      History isn't retained. Enable it in{" "}
      <Link
        to="/devices/$id/settings"
        params={{ id }}
        className="underline underline-offset-4"
      >
        Settings
      </Link>
      .
    </p>
  ) : null

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
            <div className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-4 lg:grid-cols-6">
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
                          {r.unit}
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

      {/* Recent recorded telemetry — reuses the Telemetry History table */}
      {recentTelemetry.length > 0 ? (
        <TelemetryTable
          title="Recent recorded telemetry"
          history={recentTelemetry}
          metrics={recordedMetrics}
          units={recordedUnits}
          action={telemetryViewAll}
          footer={persistNotice}
          pinFirstColumn
        />
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recent recorded telemetry</CardTitle>
            <CardAction>{telemetryViewAll}</CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {recordedLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <p className="text-sm text-muted-foreground">
                No recorded telemetry yet.
              </p>
            )}
            {persistNotice}
          </CardContent>
        </Card>
      )}

      {/* Recent media recordings — reuses the Media table (playback + delete) */}
      <Card>
        <CardHeader>
          <CardTitle>Recent media recordings</CardTitle>
          <CardAction>
            <Button asChild variant="outline" size="sm">
              <Link to="/devices/$id/media" params={{ id }}>
                View all
                <ArrowRightIcon />
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {recordings === null ? (
            <Skeleton className="h-24 w-full" />
          ) : recentRecordings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recordings yet.</p>
          ) : (
            <RecordingsTable
              deviceId={id}
              recordings={recentRecordings}
              onChanged={loadRecordings}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
