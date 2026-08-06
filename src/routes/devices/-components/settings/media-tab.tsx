import {
  Card,
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
import type { KvsChannel } from "@/lib/api"
import type { ResolvedRecording } from "@/lib/device-config-defaults"
import type {
  DeviceMediaStatus,
  DeviceRecordingStatus,
} from "@/hooks/use-iot-telemetry"
import { VideoOptions } from "./video-options"

const VIDEO_KEY = "device-recording-video-enabled"

const kvsChannelColumns: DataTableColumn<KvsChannel>[] = [
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
  recordingConfigured,
  channels,
  reportedRecording,
  reportedMedia,
  isPending,
  commitRecording,
}: {
  recording: ResolvedRecording
  /** False while `recordingConfig` is null — the cloud manages nothing yet. */
  recordingConfigured: boolean
  channels: KvsChannel[] | null
  reportedRecording: DeviceRecordingStatus | null
  reportedMedia: DeviceMediaStatus | null
  isPending: (key: string) => boolean
  commitRecording: (key: string, mutate: (r: ResolvedRecording) => void) => void
}) {
  const reportedVideo = reportedMedia?.recording?.value === true
  // Reported-vs-configured mismatch: only meaningful once we've heard from the
  // device AND the cloud actually manages the config.
  const reportedMismatch =
    reportedRecording !== null &&
    recordingConfigured &&
    (reportedRecording.enabled !== recording.telemetryEnabled ||
      reportedVideo !== recording.videoEnabled)

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

            {/* Reported state from the live 1 Hz payload: shows whether the
                device has actually applied what was asked (poor man's
                desired-vs-reported until Phase 3 of the settings-management
                plan lands the real reported channel). */}
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {reportedRecording === null ? (
                "Waiting for a live status report from the device… (the device may be offline; settings saved here are delivered when it reconnects)"
              ) : (
                <>
                  Device reports: telemetry recording{" "}
                  <span className="font-medium">
                    {reportedRecording.enabled ? "on" : "off"}
                  </span>
                  {" · "}video recording{" "}
                  <span className="font-medium">
                    {reportedVideo ? "on" : "off"}
                  </span>
                  {reportedRecording.backlogSegments > 0 ? (
                    <>
                      {" · "}
                      {formatBytes(reportedRecording.backlogBytes)} awaiting
                      upload ({reportedRecording.backlogSegments} segments
                      {reportedRecording.uploading ? ", uploading" : ""})
                    </>
                  ) : null}
                  {reportedRecording.droppedSegments > 0 ? (
                    <span className="text-amber-600 dark:text-amber-400">
                      {" · "}
                      {reportedRecording.droppedSegments} segments deleted
                      before upload (disk full)
                    </span>
                  ) : null}
                  {reportedMismatch ? (
                    <span className="text-amber-600 dark:text-amber-400">
                      {" — the device has not applied the saved settings yet"}
                    </span>
                  ) : null}
                </>
              )}
            </div>
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
