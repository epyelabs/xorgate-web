import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  DataTable,
  formatBytes,
  type DataTableColumn,
} from "@/components/data-table"
import type { Device, VideoChannel } from "@xorgate/sdk"
import type { DeviceConfigStatus } from "@/lib/device-config-status"
import type { DeviceSettingsPatch } from "@/hooks/use-device-settings"
import {
  resolveCameraMount,
  type CameraRotationDeg,
  type ResolvedRecording,
} from "@/lib/device-config-defaults"
import type {
  TelemetryMediaStatus as DeviceMediaStatus,
  TelemetryRecordingStatus as DeviceRecordingStatus,
} from "@xorgate/react"
import { cameraPresetProblem } from "@/lib/camera-catalog"
import {
  cameraRotationSwitch,
  modelCameraPorts,
  parseReportedCameras,
  portSensor,
  type CameraSensorChange,
} from "@/lib/device-cameras"
import { useDeviceModel } from "@/queries/devices"
import { ConfigStatusBadge, ConfigStatusCallout } from "./config-status"
import { SettingsCallout } from "./callout"
import { CameraSensorsCard } from "./camera-sensors-card"
import { VideoOptions, type PresetProblem } from "./video-options"

const VIDEO_KEY = "device-recording-video-enabled"
const MOUNT_KEY = (streamKey: string) => `device-camera-mount-${streamKey}`

const kvsChannelColumns: DataTableColumn<VideoChannel>[] = [
  {
    id: "stream",
    header: "Stream",
    cellClassName: "font-mono",
    cell: (channel) => channel.streamKey,
  },
  {
    id: "channel",
    header: "Channel",
    cellClassName: "font-mono",
    cell: (channel) => channel.channelName,
  },
  {
    id: "region",
    header: "Region",
    cell: (channel) => channel.region,
  },
]

export function MediaTab({
  device,
  recording,
  configStatus,
  channels,
  reportedRecording,
  reportedMedia,
  isPending,
  commit,
  commitCameraSensors,
  commitRecording,
}: {
  device: Device
  recording: ResolvedRecording
  configStatus: DeviceConfigStatus
  channels: VideoChannel[] | null
  reportedRecording: DeviceRecordingStatus | null
  reportedMedia: DeviceMediaStatus | null
  isPending: (key: string) => boolean
  commit: (key: string, patch: DeviceSettingsPatch) => void
  commitCameraSensors: (
    change: CameraSensorChange,
    ports: readonly string[] | null
  ) => void
  commitRecording: (key: string, mutate: (r: ResolvedRecording) => void) => void
}) {
  const reportedVideo = reportedMedia?.recording?.value === true
  const mounted = resolveCameraMount(device.config.cameraMount)

  // The device's model names its camera ports (the keys the sensor choice is
  // made for); the catalog then says what follows from the sensor on a port.
  const modelQuery = useDeviceModel(device.deviceModelId)
  const cameraPorts = modelCameraPorts(modelQuery.data?.ioCapabilities)
  const reportedCameras = parseReportedCameras(device.reportedConfig)
  const sensorOn = (streamKey: string) =>
    portSensor(streamKey, device.config, reportedCameras)

  // A preset the catalog says a camera's sensor cannot run, grouped by the
  // catalog's reason so two cameras on one sensor read as one warning.
  const presetProblems: PresetProblem[] = []
  for (const ch of channels ?? []) {
    if (recording.cameras[ch.streamKey] === false) continue
    const reason = cameraPresetProblem(sensorOn(ch.streamKey)?.id, recording.preset)
    if (reason === null) continue
    const same = presetProblems.find((p) => p.reason === reason)
    if (same) same.cameras.push(ch.streamKey)
    else presetProblems.push({ cameras: [ch.streamKey], reason })
  }

  /**
   * Write one camera's rotation, carrying the others through unchanged.
   *
   * Always an explicit rotation, including 0. An absent key means UNMANAGED on
   * the device — it leaves that camera's boot config exactly as it found it —
   * so turning a switch OFF has to say "0", not "nothing".
   */
  function commitRotation(streamKey: string, deg: CameraRotationDeg) {
    const cameras = Object.fromEntries(
      Object.entries({ ...mounted, [streamKey]: deg }).map(([k, v]) => [
        k,
        { rotationDeg: v },
      ])
    )
    commit(MOUNT_KEY(streamKey), { cameraMountConfig: { cameras } })
  }
  // Runtime state, NOT config: what the capture pipeline is doing right now and
  // how much is queued for upload. This half still comes off the live 1 Hz
  // payload — the config report says what the device was TOLD to do, never
  // whether a segment is currently in flight.
  const hasBacklog =
    reportedRecording !== null &&
    (reportedRecording.backlogSegments > 0 || reportedRecording.droppedSegments > 0)

  return (
    <div className="flex w-full flex-col gap-4">
      {channels && channels.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Cameras</CardTitle>
            <CardDescription>
              Which cameras this device runs at all — live view and recording
              both.
            </CardDescription>
            <CardAction>
              <ConfigStatusBadge status={configStatus.recording} />
            </CardAction>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {channels.map((ch) => {
                const key = `device-recording-camera-${ch.streamKey}`
                return (
                  <Field key={ch.streamKey} orientation="horizontal">
                    <FieldContent>
                      <FieldLabel htmlFor={key}>
                        Use camera{" "}
                        <span className="font-mono">{ch.streamKey}</span>
                      </FieldLabel>
                      <FieldDescription>
                        Turning a camera off shuts it down completely — no
                        recording, no live view, no power drawn. Use one camera
                        on an installation with a weaker power supply.
                      </FieldDescription>
                    </FieldContent>
                    <Switch
                      id={key}
                      checked={recording.cameras[ch.streamKey] !== false}
                      disabled={isPending(key)}
                      onCheckedChange={(next) =>
                        commitRecording(key, (r) => {
                          r.cameras = { ...r.cameras, [ch.streamKey]: next }
                        })
                      }
                    />
                  </Field>
                )
              })}
            </FieldGroup>
          </CardContent>
        </Card>
      ) : null}

      <CameraSensorsCard
        device={device}
        ports={cameraPorts}
        modelState={
          modelQuery.isPending ? "loading" : modelQuery.isError ? "error" : "ready"
        }
        status={configStatus.cameraSensors}
        isPending={isPending}
        commitCameraSensors={commitCameraSensors}
      />

      {channels && channels.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Camera mounting</CardTitle>
            <CardDescription>
              How each camera is fitted. A camera mounted upside down is turned
              back at the image sensor, so live view, recordings, replays and
              anything the workflows look at are all corrected at once — and it
              costs the device nothing to do.
            </CardDescription>
            <CardAction>
              <ConfigStatusBadge status={configStatus.cameraMount} />
            </CardAction>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {channels.map((ch) => {
                const key = MOUNT_KEY(ch.streamKey)
                // The catalog knows which sensors apply no flip at all. The
                // device refuses the rotation for one too; saying it here
                // saves the operator a save and a reboot to find out. The
                // switch is never stuck ON, though: see `cameraRotationSwitch`.
                const { cannotRotate, locked } = cameraRotationSwitch(
                  sensorOn(ch.streamKey),
                  mounted[ch.streamKey]
                )
                return (
                  <Field key={ch.streamKey} orientation="horizontal">
                    <FieldContent>
                      <FieldLabel htmlFor={key}>
                        Camera <span className="font-mono">{ch.streamKey}</span>{" "}
                        is mounted upside down
                      </FieldLabel>
                      <FieldDescription>
                        {cannotRotate
                          ? "This sensor cannot be rotated."
                          : "Rotates the picture 180°. Takes effect the next time the " +
                            "device boots — use Reboot Device at the top of this page " +
                            "once you have set it."}
                      </FieldDescription>
                    </FieldContent>
                    <Switch
                      id={key}
                      checked={mounted[ch.streamKey] === 180}
                      disabled={isPending(key) || locked}
                      onCheckedChange={(next) =>
                        commitRotation(ch.streamKey, next ? 180 : 0)
                      }
                    />
                  </Field>
                )
              })}
              {/* Where "saved, but the device is still running the old
                  orientation until it reboots" is said out loud — the device
                  reports that state itself, with which camera and which
                  rotation, so nothing here has to infer it. */}
              <ConfigStatusCallout status={configStatus.cameraMount} />
            </FieldGroup>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Record video</CardTitle>
          <CardDescription>
            Capture video on the device itself — recording continues while
            offline and uploads to the cloud whenever the device is connected.
            Recorded runs appear under Media Recordings.
          </CardDescription>
          <CardAction>
            <ConfigStatusBadge status={configStatus.recording} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={VIDEO_KEY}>
                  Record video on device
                </FieldLabel>
                <FieldDescription>
                  Off by default. Records every camera continuously in short
                  segments. Note: turning this on or off (or changing the
                  quality) briefly restarts the live stream — an open live view
                  pauses for a few seconds and reconnects on its own.
                </FieldDescription>
              </FieldContent>
              <Switch
                id={VIDEO_KEY}
                checked={recording.videoEnabled}
                disabled={isPending(VIDEO_KEY)}
                onCheckedChange={(next) =>
                  commitRecording(VIDEO_KEY, (r) => {
                    r.videoEnabled = next
                  })
                }
              />
            </Field>

            {recording.videoEnabled ? (
              <VideoOptions
                recording={recording}
                presetProblems={presetProblems}
                isPending={isPending}
                commitRecording={commitRecording}
              />
            ) : null}

            {/* Desired-vs-reported (Phase 3) now comes from the device's own
                config report, not from inferring it off the live payload. The
                strip this replaces guessed at a mismatch by comparing two
                telemetry gauges against the saved config — it could say "not
                applied yet" but never why, and it went blind the moment the
                device was offline. */}
            <ConfigStatusCallout status={configStatus.recording} />

            {/* Runtime state deliberately KEPT on telemetry: what the capture
                pipeline is doing this second, and what is queued for upload.
                The config plane has no opinion on either. */}
            {reportedRecording !== null ? (
              <SettingsCallout>
                Recording now: telemetry{" "}
                <span className="font-medium">
                  {reportedRecording.enabled ? "on" : "off"}
                </span>
                {" · "}video{" "}
                <span className="font-medium">
                  {reportedVideo ? "on" : "off"}
                </span>
                {hasBacklog && reportedRecording.backlogSegments > 0 ? (
                  <>
                    {" · "}
                    {formatBytes(reportedRecording.backlogBytes)} awaiting upload
                    ({reportedRecording.backlogSegments} segments
                    {reportedRecording.uploading ? ", uploading" : ""})
                  </>
                ) : null}
                {reportedRecording.droppedSegments > 0 ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    {" · "}
                    {reportedRecording.droppedSegments} segments deleted before
                    upload (disk full)
                  </span>
                ) : null}
              </SettingsCallout>
            ) : null}
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Media channels</CardTitle>
          <CardDescription>
            KVS signaling channels provisioned for live video. Read-only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {channels === null ? (
            <Skeleton className="h-16 w-full" />
          ) : channels.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No media channels — device not provisioned.
            </p>
          ) : (
            <DataTable
              card={false}
              columns={kvsChannelColumns}
              rows={channels}
              getRowKey={(channel) => channel.streamKey}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
