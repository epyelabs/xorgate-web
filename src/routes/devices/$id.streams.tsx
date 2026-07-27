import { useEffect, useState } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  ApiError,
  getDevice,
  getDeviceModel,
  type ActiveStreamsViewType,
  type ImuView,
  type IoCapabilities,
} from "@/lib/api"
import {
  getDeviceModelResponseSchema,
  getDeviceResponseSchema,
} from "@/lib/schemas"
import { useAuthStore } from "@/store/auth"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import { useIotTelemetry } from "@/hooks/use-iot-telemetry"
import {
  StreamsSkeleton,
  StreamsView,
} from "@/components/streams-view/streams-view"
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

// Live page for the shared StreamsView (R8): owns the device/model fetch, the
// live telemetry feed, and the live-only KVS video grid; the Card/Map layouts
// themselves live in components/streams-view.
function DeviceStreamsPage() {
  const { id } = Route.useParams()
  const [caps, setCaps] = useState<IoCapabilities | null>(null)
  const [viewType, setViewType] = useState<ActiveStreamsViewType>("card")
  const [imuView, setImuView] = useState<ImuView | null>(null)
  const [metaLoading, setMetaLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Map View camera follow: auto-centres on new fixes until the operator pans or
  // zooms, then pauses (Recenter resumes). Owned here so it survives view
  // switches; the view reports interactions through onFollowingChange.
  const [following, setFollowing] = useState(true)
  const {
    latest,
    history,
    media,
    status,
    error: connError,
  } = useIotTelemetry(id)

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
        setViewType(parsedDevice.data.device.activeStreamsViewType)
        setImuView(parsedDevice.data.device.imuView)

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
        if (!cancelled) setMetaLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const videoCaps = caps?.media?.video ?? []

  // Live position + trailing breadcrumb for the Map View, derived from the same
  // telemetry the card view reads. Coordinates are [lon, lat] (Mapbox order).
  const lat = latest["gps.lat"]?.value
  const lon = latest["gps.lon"]?.value
  const position: [number, number] | null =
    typeof lat === "number" && typeof lon === "number" ? [lon, lat] : null
  // Course over ground (deg true) — drives the marker's direction indicator.
  // Absent when the device is stationary or has no lock, so it stays null then.
  const courseVal = latest["gps.course"]?.value
  const course = typeof courseVal === "number" ? courseVal : null
  const track: [number, number][] = []
  for (const p of history) {
    const pLat = p["gps.lat"]
    const pLon = p["gps.lon"]
    if (typeof pLat === "number" && typeof pLon === "number") {
      track.push([pLon, pLat])
    }
  }

  // On-device video recording is a single device-level flag in the payload
  // (media.recording.value), not per-camera — so every tile shows the dot while
  // the device is recording, which is correct: it records all configured cameras.
  const recordingOnDevice = media?.recording?.value === true
  // The section wrapper around the grid comes from StreamsView; the null here
  // (no video capabilities) suppresses it, matching the old inline gate.
  const videoSlot =
    videoCaps.length > 0 ? (
      viewType === "map" ? (
        <LiveVideoGrid
          deviceId={id}
          videoCaps={videoCaps}
          recordingOnDevice={recordingOnDevice}
        />
      ) : (
        <LiveVideoGrid
          deviceId={id}
          videoCaps={videoCaps}
          title="Media"
          recordingOnDevice={recordingOnDevice}
        />
      )
    ) : null

  if (viewType === "map") {
    return (
      <StreamsView
        viewType="map"
        caps={caps}
        latest={latest}
        imuView={imuView}
        position={position}
        track={track}
        course={course}
        following={following}
        onFollowingChange={setFollowing}
        videoSlot={videoSlot}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {status === "error" && connError ? (
        <p className="text-sm text-destructive">{connError}</p>
      ) : null}
      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : null}

      {metaLoading ? (
        <StreamsSkeleton />
      ) : (
        <StreamsView
          viewType="card"
          caps={caps}
          latest={latest}
          imuView={imuView}
          position={position}
          track={track}
          course={course}
          following={following}
          onFollowingChange={setFollowing}
          videoSlot={videoSlot}
        />
      )}
    </div>
  )
}
