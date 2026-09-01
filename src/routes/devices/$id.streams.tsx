import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { useLiveBlock, useLiveTelemetry } from "@xorgate/react"
import { xgMessage } from "@/lib/xorgate"
import { useDevice, useDeviceModel } from "@/queries/devices"
import {
  StreamsSkeleton,
  StreamsView,
} from "@/components/streams-view/streams-view"
import { LiveVideoGrid } from "@/components/live-video-grid"

export const Route = createFileRoute("/devices/$id/streams")({
  beforeLoad: requireAuth,
  component: DeviceStreamsPage,
})

// Live page for the shared StreamsView (R8): owns the device/model fetch, the
// live telemetry feed, and the live-only KVS video grid; the Card/Map layouts
// themselves live in components/streams-view.
function DeviceStreamsPage() {
  const { id } = Route.useParams()
  // Same query keys the layout polls, so a tab switch renders from cache with
  // no request and no skeleton; the poll keeps prefs/config current behind it.
  const deviceQuery = useDevice(id)
  const device = deviceQuery.data ?? null
  const modelQuery = useDeviceModel(device?.deviceModelId)
  const caps = modelQuery.data?.ioCapabilities ?? null
  // Per-camera enables from the device's recording config (keyed by stream key;
  // absent = enabled). Drives the "camera turned off" placeholder in the grid.
  const cameraEnables = device?.config.recording?.video?.cameras
  const viewType = device?.uiPrefs.activeStreamsViewType ?? "card"
  const imuView = device?.uiPrefs.imuView ?? null
  const metaLoading =
    deviceQuery.isPending || (device !== null && modelQuery.isPending)
  const loadError =
    !device && deviceQuery.error
      ? xgMessage(deviceQuery.error)
      : device && !caps && modelQuery.error
        ? xgMessage(modelQuery.error)
        : null
  // Map View camera follow: auto-centres on new fixes until the operator pans or
  // zooms, then pauses (Recenter resumes). Owned here so it survives view
  // switches; the view reports interactions through onFollowingChange.
  const [following, setFollowing] = useState(true)
  const {
    latest,
    history,
    media,
    recording,
    receivedAt,
    status,
    error: connError,
  } = useLiveTelemetry(id)
  // Is the device refusing to run live KVS masters right now, and why? Resolved
  // (with fail-open + staleness) in one place and handed to the grid, which
  // renders a tile instead of mounting a viewer against a parked master.
  const liveBlock = useLiveBlock({ status, recording, receivedAt })

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
          cameraEnables={cameraEnables}
          liveBlock={liveBlock}
        />
      ) : (
        <LiveVideoGrid
          deviceId={id}
          videoCaps={videoCaps}
          title="Media"
          recordingOnDevice={recordingOnDevice}
          cameraEnables={cameraEnables}
          liveBlock={liveBlock}
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
        <p className="text-sm text-destructive">{xgMessage(connError)}</p>
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
