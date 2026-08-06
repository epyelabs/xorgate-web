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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { ResolvedRecording } from "@/lib/device-config-defaults"
import type { DeviceConfigStatus } from "@/lib/device-config-status"
import { ConfigStatusBadge, ConfigStatusCallout } from "./config-status"
import { withCurrent } from "./shared"

const SHED_KEY = "device-power-shedding-enabled"
const CPU_TEMP_KEY = "device-power-shedding-cpu-temp"
const CPU_TEMP_RESTORE_KEY = "device-power-shedding-cpu-temp-restore"
const CPU_TEMP_SECS_KEY = "device-power-shedding-cpu-temp-secs"

// Thermal load-shed arm (power_management_improvements plan, Phases 1+3).
// Offered values sit inside the backend's accepted ranges (cpuTempC 50-90,
// cpuTempRestoreC 40-85, cpuTempSecs 5-120) — a Select rather than a free
// number input so the form can never PUT a value the API will reject, and so
// the restore list can be filtered against the trigger (below).
const CPU_TEMP_C_OPTIONS = [65, 70, 75, 80, 85, 90]
const CPU_TEMP_RESTORE_C_OPTIONS = [55, 60, 65, 70, 75, 80]
const CPU_TEMP_SECS_OPTIONS = [5, 10, 15, 30, 60, 120]

// Keep the restore point below the trigger: equal or above means the device can
// shed and instantly qualify to restore, tearing live streams down and back up
// in a loop (README principle 4). The 10 °C default gap also keeps the restore
// point clear of the ~3 °C sample noise that kept a bench device shed for
// minutes on 2026-08-05. Lives here, in the commit layer, rather than inside a
// select's handler.
function setCpuTempTrigger(r: ResolvedRecording, cpuTempC: number) {
  r.cpuTempC = cpuTempC
  if (r.cpuTempRestoreC >= r.cpuTempC) {
    r.cpuTempRestoreC = Math.max(CPU_TEMP_RESTORE_C_OPTIONS[0], r.cpuTempC - 10)
  }
}

export function PowerTab({
  recording,
  cpuTemp,
  configStatus,
  isPending,
  commitRecording,
}: {
  recording: ResolvedRecording
  configStatus: DeviceConfigStatus
  /** Live SoC temperature from the 1 Hz payload; null until the first arrives. */
  cpuTemp: number | null
  isPending: (key: string) => boolean
  commitRecording: (key: string, mutate: (r: ResolvedRecording) => void) => void
}) {
  return (
    <div className="flex w-full flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Power protection</CardTitle>
          <CardDescription>
            What the device gives up, and in what order, when its supply or its
            temperature stops being able to carry the full workload.
          </CardDescription>
          <CardAction>
            <ConfigStatusBadge status={configStatus.recording} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={SHED_KEY}>Power protection</FieldLabel>
                <FieldDescription>
                  On a failing power supply the device automatically pauses live
                  streaming first, then video recording, and resumes once the
                  supply recovers — instead of crashing mid-drive. Recommended
                  on.
                </FieldDescription>
              </FieldContent>
              <Switch
                id={SHED_KEY}
                checked={recording.powerSheddingEnabled}
                disabled={isPending(SHED_KEY)}
                onCheckedChange={(next) =>
                  commitRecording(SHED_KEY, (r) => {
                    r.powerSheddingEnabled = next
                  })
                }
              />
            </Field>

            {recording.powerSheddingEnabled ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={CPU_TEMP_KEY}>
                    Pause live streaming above
                  </FieldLabel>
                  <Select
                    value={String(recording.cpuTempC)}
                    disabled={isPending(CPU_TEMP_KEY)}
                    onValueChange={(v) =>
                      commitRecording(CPU_TEMP_KEY, (r) =>
                        setCpuTempTrigger(r, Number(v))
                      )
                    }
                  >
                    <SelectTrigger id={CPU_TEMP_KEY}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {withCurrent(CPU_TEMP_C_OPTIONS, recording.cpuTempC).map(
                        (t) => (
                          <SelectItem key={t} value={String(t)}>
                            {t} °C{t === 80 ? " (default)" : ""}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    When the device&apos;s processor reaches this temperature it
                    stops live streaming so it can cool down. Recording keeps
                    running — heat never costs you footage.
                    {cpuTemp !== null ? (
                      <>
                        {" "}
                        <span className="tabular-nums">
                          Right now: {cpuTemp.toFixed(1)} °C.
                        </span>
                      </>
                    ) : null}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor={CPU_TEMP_RESTORE_KEY}>
                    Resume below
                  </FieldLabel>
                  <Select
                    value={String(recording.cpuTempRestoreC)}
                    disabled={isPending(CPU_TEMP_RESTORE_KEY)}
                    onValueChange={(v) =>
                      commitRecording(CPU_TEMP_RESTORE_KEY, (r) => {
                        r.cpuTempRestoreC = Number(v)
                      })
                    }
                  >
                    <SelectTrigger id={CPU_TEMP_RESTORE_KEY}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {withCurrent(
                        CPU_TEMP_RESTORE_C_OPTIONS,
                        recording.cpuTempRestoreC
                      )
                        // Only offer values that are genuinely below the
                        // trigger, for the anti-flap reason above.
                        .filter((t) => t < recording.cpuTempC)
                        .map((t) => (
                          <SelectItem key={t} value={String(t)}>
                            {t} °C{t === 70 ? " (default)" : ""}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Live streaming comes back once the device has stayed at or
                    below this temperature for a while. Set it well clear of the
                    pause temperature: a device that settles just above this
                    point never resumes. Recovery takes minutes, not seconds.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor={CPU_TEMP_SECS_KEY}>
                    Confirm heat for
                  </FieldLabel>
                  <Select
                    value={String(recording.cpuTempSecs)}
                    disabled={isPending(CPU_TEMP_SECS_KEY)}
                    onValueChange={(v) =>
                      commitRecording(CPU_TEMP_SECS_KEY, (r) => {
                        r.cpuTempSecs = Number(v)
                      })
                    }
                  >
                    <SelectTrigger id={CPU_TEMP_SECS_KEY}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {withCurrent(
                        CPU_TEMP_SECS_OPTIONS,
                        recording.cpuTempSecs
                      ).map((s) => (
                        <SelectItem key={s} value={String(s)}>
                          {s} seconds{s === 15 ? " (default)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    How long the device must stay that hot before it acts, so a
                    brief spike doesn&apos;t interrupt a live view.
                  </FieldDescription>
                </Field>
              </div>
            ) : null}
            <ConfigStatusCallout status={configStatus.recording} />
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  )
}
