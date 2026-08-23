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
import type { VideoChannel } from "@xorgate/sdk"
import type { DeviceConfigStatus } from "@/lib/device-config-status"
import type { ResolvedRecording } from "@/lib/device-config-defaults"
import type {
  TelemetryMediaStatus as DeviceMediaStatus,
  TelemetryRecordingStatus as DeviceRecordingStatus,
} from "@xorgate/react"
import { ConfigStatusBadge, ConfigStatusCallout } from "./config-status"
import { SettingsCallout } from "./callout"
import { VideoOptions } from "./video-options"

const VIDEO_KEY = "device-recording-video-enabled"

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
  recording,
  configStatus,
  channels,
  reportedRecording,
  reportedMedia,
  isPending,
  commitRecording,
}: {
  recording: ResolvedRecording
  configStatus: DeviceConfigStatus
  channels: VideoChannel[] | null
  reportedRecording: DeviceRecordingStatus | null
  reportedMedia: DeviceMediaStatus | null
  isPending: (key: string) => boolean
  commitRecording: (key: string, mutate: (r: ResolvedRecording) => void) => void
}) {
  const reportedVideo = reportedMedia?.recording?.value === true
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
                        on a vehicle with a weaker power supply.
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
