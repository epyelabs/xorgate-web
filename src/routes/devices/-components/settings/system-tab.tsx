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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { formatBytes } from "@/components/data-table"
import type { Device } from "@/lib/api"
import type { DeviceSettingsPatch } from "@/hooks/use-device-settings"
import {
  DEFAULT_TIME_SYNC_OFFLINE_SOURCES,
  GIB,
  type ResolvedRecording,
} from "@/lib/device-config-defaults"
import { withCurrent } from "./shared"

const TIME_SYNC_KEY = "device-time-sync-offline"
const UPLOAD_KEY = "device-recording-upload-mode"
const RETENTION_KEY = "device-recording-retention-max-bytes"

const RETENTION_GIB_OPTIONS = [2, 5, 10, 20, 50]

export function SystemTab({
  device,
  recording,
  isPending,
  commit,
  commitRecording,
}: {
  device: Device
  recording: ResolvedRecording
  isPending: (key: string) => boolean
  commit: (key: string, patch: DeviceSettingsPatch) => void
  commitRecording: (key: string, mutate: (r: ResolvedRecording) => void) => void
}) {
  const timeSync = device.timeSyncConfig

  return (
    <div className="flex w-full flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Clock</CardTitle>
          <CardDescription>
            Where the device gets the time when it can&apos;t reach the internet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={TIME_SYNC_KEY}>
                  Set the clock from GPS when offline
                </FieldLabel>
                <FieldDescription>
                  On by default. Until internet time sync succeeds after a boot,
                  the device corrects a wrong clock from GPS (or the cellular
                  network) so recordings carry accurate timestamps — e.g. when
                  driving out of an underground garage. Stands down
                  automatically once internet time sync lands. Applied by the
                  device without a restart.
                </FieldDescription>
              </FieldContent>
              <Switch
                id={TIME_SYNC_KEY}
                checked={
                  timeSync?.offlineSources ?? DEFAULT_TIME_SYNC_OFFLINE_SOURCES
                }
                disabled={isPending(TIME_SYNC_KEY)}
                onCheckedChange={(next) =>
                  // Spreading the stored object preserves threshold/cap knobs
                  // set out-of-band (xorgate set / API).
                  commit(TIME_SYNC_KEY, {
                    timeSyncConfig: {
                      ...(timeSync ?? {}),
                      offlineSources: next,
                    },
                  })
                }
              />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Storage &amp; upload</CardTitle>
          <CardDescription>
            One budget and one upload switch across everything the device
            records — trip logs and video share the same recordings tree.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={UPLOAD_KEY}>Upload automatically</FieldLabel>
                <FieldDescription>
                  Send recordings to the cloud whenever the device is online
                  (oldest first; local copies are removed once safely uploaded).
                  Turn off to keep recordings on the device only.
                </FieldDescription>
              </FieldContent>
              <Switch
                id={UPLOAD_KEY}
                checked={recording.uploadMode === "auto"}
                disabled={isPending(UPLOAD_KEY)}
                onCheckedChange={(next) =>
                  commitRecording(UPLOAD_KEY, (r) => {
                    r.uploadMode = next ? "auto" : "off"
                  })
                }
              />
            </Field>

            <Field>
              <FieldLabel htmlFor={RETENTION_KEY}>Storage limit</FieldLabel>
              <Select
                value={String(recording.maxBytes)}
                disabled={isPending(RETENTION_KEY)}
                onValueChange={(v) =>
                  commitRecording(RETENTION_KEY, (r) => {
                    r.maxBytes = Number(v)
                  })
                }
              >
                <SelectTrigger id={RETENTION_KEY}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {withCurrent(
                    RETENTION_GIB_OPTIONS.map((g) => g * GIB),
                    recording.maxBytes
                  ).map((b) => (
                    <SelectItem key={b} value={String(b)}>
                      {formatBytes(b)}
                      {b === 10 * GIB ? " (default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Cap on recordings kept on the device. When full, the oldest
                not-yet-uploaded segments are deleted first — the sessions list
                will flag any dropped data.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  )
}
