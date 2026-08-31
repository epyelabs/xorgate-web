import { useEffect, useState } from "react"
import { toast } from "sonner"
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
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { Device } from "@xorgate/sdk"
import type { ImuMount } from "@/lib/xorgate"
import type { DeviceSettingsPatch } from "@/hooks/use-device-settings"
import {
  DEFAULT_IMU_MOUNT,
  type ResolvedRecording,
} from "@/lib/device-config-defaults"
import type { DeviceConfigStatus } from "@/lib/device-config-status"
import { ConfigStatusBadge, ConfigStatusCallout } from "./config-status"
import { parseAngle, withCurrent } from "./shared"

const TELEMETRY_KEY = "device-recording-telemetry-enabled"
const RATE_KEY = "device-recording-telemetry-rate"
const IMU_MOUNT_KEY = "device-imu-mount"

const RATE_HZ_OPTIONS = [1, 2, 5, 10, 20]

export function TelemetryTab({
  device,
  recording,
  configStatus,
  isPending,
  commit,
  commitRecording,
}: {
  device: Device
  recording: ResolvedRecording
  configStatus: DeviceConfigStatus
  isPending: (key: string) => boolean
  commit: (key: string, patch: DeviceSettingsPatch) => void
  commitRecording: (key: string, mutate: (r: ResolvedRecording) => void) => void
}) {
  const mount = device.config.imuMount ?? DEFAULT_IMU_MOUNT
  // Angle inputs are strings so partial numeric input ("-", "1.") never fights
  // the user; parsed on commit and re-seeded from the device, which is also how
  // a failed save snaps them back.
  const [roll, setRoll] = useState(String(mount.rollDeg))
  const [pitch, setPitch] = useState(String(mount.pitchDeg))
  const [yaw, setYaw] = useState(String(mount.yawDeg))
  useEffect(() => {
    setRoll(String(mount.rollDeg))
    setPitch(String(mount.pitchDeg))
    setYaw(String(mount.yawDeg))
  }, [mount.rollDeg, mount.pitchDeg, mount.yawDeg])

  function snapMountInputs() {
    setRoll(String(mount.rollDeg))
    setPitch(String(mount.pitchDeg))
    setYaw(String(mount.yawDeg))
  }

  function commitImuMount(enabled: boolean) {
    const rollDeg = parseAngle(roll)
    const pitchDeg = parseAngle(pitch)
    const yawDeg = parseAngle(yaw)
    if (rollDeg === null || pitchDeg === null || yawDeg === null) {
      toast.error("Mounting offsets must be numbers (degrees)")
      snapMountInputs()
      return
    }
    const next: ImuMount = { enabled, rollDeg, pitchDeg, yawDeg }
    // Snap inputs back to canonical form (e.g. "090" -> "90"); the hook's own
    // equality check drops the no-op save.
    snapMountInputs()
    commit(IMU_MOUNT_KEY, { imuMount: next })
  }

  const mountPending = isPending(IMU_MOUNT_KEY)

  return (
    <div className="flex w-full flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Record telemetry</CardTitle>
          <CardDescription>
            Log sensor readings on the device itself — recording continues while
            offline and uploads whenever the device is connected.
          </CardDescription>
          <CardAction>
            <ConfigStatusBadge status={configStatus.recording} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={TELEMETRY_KEY}>
                  Record telemetry on device
                </FieldLabel>
                <FieldDescription>
                  Off by default. Samples sensors at the rate below (up to
                  20&nbsp;Hz, above the 1&nbsp;Hz live feed) and becomes the
                  authoritative telemetry history once uploaded.
                </FieldDescription>
              </FieldContent>
              <Switch
                id={TELEMETRY_KEY}
                checked={recording.telemetryEnabled}
                disabled={isPending(TELEMETRY_KEY)}
                onCheckedChange={(next) =>
                  commitRecording(TELEMETRY_KEY, (r) => {
                    r.telemetryEnabled = next
                  })
                }
              />
            </Field>

            {recording.telemetryEnabled ? (
              <Field>
                <FieldLabel htmlFor={RATE_KEY}>Sample rate</FieldLabel>
                <Select
                  value={String(recording.rateHz)}
                  disabled={isPending(RATE_KEY)}
                  onValueChange={(v) =>
                    commitRecording(RATE_KEY, (r) => {
                      r.rateHz = Number(v)
                    })
                  }
                >
                  <SelectTrigger id={RATE_KEY}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {withCurrent(RATE_HZ_OPTIONS, recording.rateHz).map((hz) => (
                      <SelectItem key={hz} value={String(hz)}>
                        {hz} Hz{hz === 1 ? " (default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Motion (IMU) records at this rate; GPS and system metrics
                  record at their natural once-per-second pace.
                </FieldDescription>
              </Field>
            ) : null}
            {/* `recording` is one namespace spanning four tabs, so this verdict
                covers every recording control, not just the two above. */}
            <ConfigStatusCallout status={configStatus.recording} />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>IMU mounting</CardTitle>
          <CardDescription>
            Correct roll, pitch and yaw for how the enclosure is physically
            installed in the vehicle.
          </CardDescription>
          <CardAction>
            <ConfigStatusBadge status={configStatus.imuMount} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="device-imu-mount-enabled">
                  Correct for mounting orientation
                </FieldLabel>
                <FieldDescription>
                  Off by default. When on, the device re-expresses roll, pitch
                  and yaw in the vehicle&apos;s frame using the rotation below.
                  The raw quaternion and the sensor&apos;s factory calibration
                  are untouched; already-stored history is not rewritten.
                </FieldDescription>
              </FieldContent>
              <Switch
                id="device-imu-mount-enabled"
                checked={mount.enabled}
                disabled={mountPending}
                onCheckedChange={(next) => commitImuMount(next)}
              />
            </Field>

            <Field>
              <FieldLabel>Enclosure rotation (degrees)</FieldLabel>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Roll</span>
                  <Input
                    id="device-imu-mount-roll"
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={roll}
                    disabled={mountPending}
                    onChange={(e) => setRoll(e.target.value)}
                    onBlur={() => commitImuMount(mount.enabled)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Pitch</span>
                  <Input
                    id="device-imu-mount-pitch"
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={pitch}
                    disabled={mountPending}
                    onChange={(e) => setPitch(e.target.value)}
                    onBlur={() => commitImuMount(mount.enabled)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Yaw</span>
                  <Input
                    id="device-imu-mount-yaw"
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={yaw}
                    disabled={mountPending}
                    onChange={(e) => setYaw(e.target.value)}
                    onBlur={() => commitImuMount(mount.enabled)}
                  />
                </div>
              </div>
              <FieldDescription>
                How the box is rotated relative to the vehicle, applied as yaw,
                then pitch, then roll. Examples: mounted sideways (roll and
                pitch appear swapped) → yaw 90; facing backwards (yaw off by
                half a turn) → yaw 180; standing on its side → roll 90. Saved
                automatically; applies live within a couple of seconds.
              </FieldDescription>
            </Field>
            {/* The one card that carried a badge but no callout. Harmless while
                the badge could only say "Synced", but a `diverged` badge has
                to tell the operator what to DO about it. */}
            <ConfigStatusCallout status={configStatus.imuMount} />
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  )
}
