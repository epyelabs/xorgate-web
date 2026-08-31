import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { VideoPresetName } from "@/lib/xorgate"
import type { ResolvedRecording } from "@/lib/device-config-defaults"
import { formatSeconds, withCurrent } from "./shared"

export const PRESET_KEY = "device-recording-video-preset"
export const SEGMENT_KEY = "device-recording-video-segment"
export const BOOT_DEFER_KEY = "device-recording-boot-defer"
export const BOOT_DEFER_MAX_KEY = "device-recording-boot-defer-max"
export const GPS_GATE_KEY = "device-recording-gps-gate"
export const GPS_GATE_MAX_KEY = "device-recording-gps-gate-max"
export const GPS_GATE_NO_PROGRESS_KEY = "device-recording-gps-gate-no-progress"

// On-device recording (offline recording plan, Phase 5). Display defaults
// mirror the device agent's RECORDING_DEFAULTS (device src/recording/config.ts)
// so a device with recordingConfig null renders exactly what it is doing.
// `1080p30-4mbps` is NOT recommended and must not read as "best": it is the
// only preset whose bridge branch runs videorate (30→15) and videoscale
// (1080→720) both non-passthrough, and that pair deadlocks the capture
// pipeline before the first frame — bench-measured 2026-08-06 at roughly 1 spawn
// in 4, recording nothing and blacking out live view. The device-side watchdog
// now catches and retries it, but a retry can stall again, so the honest
// operator-facing signal is "experimental". See plans/1080p30fps_bug/PROGRESS.md;
// the pipeline fix (videoscale BEFORE videorate, ~+22 % of one core) is open.
const VIDEO_PRESET_OPTIONS: { value: VideoPresetName; label: string }[] = [
  {
    value: "1080p30-4mbps",
    label: "1080p 30 fps · 4 Mbps (experimental, highest CPU)",
  },
  { value: "1080p15-2mbps", label: "1080p 15 fps · 2 Mbps (highest quality)" },
  { value: "720p30-2mbps", label: "720p 30 fps · 2 Mbps (smoother motion)" },
  { value: "720p15-2mbps", label: "720p 15 fps · 2 Mbps (lower CPU)" },
  {
    value: "720p15-1mbps",
    label: "720p 15 fps · 1 Mbps (default — lowest CPU, smallest files)",
  },
]
const SEGMENT_SECONDS_OPTIONS = [30, 60, 120, 300]

// Boot power staging (optimize-system-process-cycle plan, Phase 2). Display
// defaults mirror the device agent's RECORDING_DEFAULTS.
const BOOT_DEFER_OPTIONS: {
  value: "auto" | "always" | "off"
  label: string
}[] = [
  { value: "auto", label: "Auto — only on constrained power (default)" },
  { value: "always", label: "Always — stage every boot" },
  { value: "off", label: "Off — start everything immediately" },
]
const BOOT_DEFER_MAX_SECS_OPTIONS = [30, 60, 90, 120, 180]
// GPS/LTE video gate (Phase 7). Same tri-state as boot staging, but the wait
// is for the whole acquisition phase, not just modem bring-up.
const GPS_GATE_OPTIONS: {
  value: "auto" | "always" | "off"
  label: string
}[] = [
  { value: "auto", label: "Auto — only on a weak power supply (default)" },
  { value: "always", label: "Always — wait on every boot" },
  { value: "off", label: "Off — start video without waiting" },
]
// 0 is deliberately offered: "wait as long as it takes" (the other release
// conditions — dead zone, no signal in view — still bound it).
const GPS_GATE_MAX_SECS_OPTIONS = [0, 120, 300, 600, 900, 1800]
const GPS_GATE_NO_PROGRESS_SECS_OPTIONS = [0, 60, 120, 180, 300, 600]

/** The knobs revealed once "Record video on device" is on. */
export function VideoOptions({
  recording,
  isPending,
  commitRecording,
}: {
  recording: ResolvedRecording
  isPending: (key: string) => boolean
  commitRecording: (key: string, mutate: (r: ResolvedRecording) => void) => void
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field>
        <FieldLabel htmlFor={PRESET_KEY}>Quality</FieldLabel>
        <Select
          value={recording.preset}
          disabled={isPending(PRESET_KEY)}
          onValueChange={(v) =>
            commitRecording(PRESET_KEY, (r) => {
              r.preset = v as VideoPresetName
            })
          }
        >
          <SelectTrigger id={PRESET_KEY}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIDEO_PRESET_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel htmlFor={SEGMENT_KEY}>Segment length</FieldLabel>
        <Select
          value={String(recording.segmentSeconds)}
          disabled={isPending(SEGMENT_KEY)}
          onValueChange={(v) =>
            commitRecording(SEGMENT_KEY, (r) => {
              r.segmentSeconds = Number(v)
            })
          }
        >
          <SelectTrigger id={SEGMENT_KEY}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {withCurrent(
              SEGMENT_SECONDS_OPTIONS,
              recording.segmentSeconds
            ).map((s) => (
              <SelectItem key={s} value={String(s)}>
                {formatSeconds(s)}
                {s === 60 ? " (default)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel htmlFor={BOOT_DEFER_KEY}>Boot power staging</FieldLabel>
        <Select
          value={recording.bootDefer}
          disabled={isPending(BOOT_DEFER_KEY)}
          onValueChange={(v) =>
            commitRecording(BOOT_DEFER_KEY, (r) => {
              r.bootDefer = v as "auto" | "always" | "off"
            })
          }
        >
          <SelectTrigger id={BOOT_DEFER_KEY}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BOOT_DEFER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          Waits for the cellular modem to settle after power-on before starting
          the video encoders, easing the load on a weak power supply. Live
          streaming stays available while waiting.
        </FieldDescription>
      </Field>

      {recording.bootDefer !== "off" ? (
        <Field>
          <FieldLabel htmlFor={BOOT_DEFER_MAX_KEY}>
            Staging time limit
          </FieldLabel>
          <Select
            value={String(recording.bootDeferMaxSecs)}
            disabled={isPending(BOOT_DEFER_MAX_KEY)}
            onValueChange={(v) =>
              commitRecording(BOOT_DEFER_MAX_KEY, (r) => {
                r.bootDeferMaxSecs = Number(v)
              })
            }
          >
            <SelectTrigger id={BOOT_DEFER_MAX_KEY}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {withCurrent(
                BOOT_DEFER_MAX_SECS_OPTIONS,
                recording.bootDeferMaxSecs
              ).map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {formatSeconds(s)}
                  {s === 90 ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            Recording always starts within this bound, even if the modem never
            settles.
          </FieldDescription>
        </Field>
      ) : null}

      <Field>
        <FieldLabel htmlFor={GPS_GATE_KEY}>Wait for GPS and cellular</FieldLabel>
        <Select
          value={recording.gpsGate}
          disabled={isPending(GPS_GATE_KEY)}
          onValueChange={(v) =>
            commitRecording(GPS_GATE_KEY, (r) => {
              r.gpsGate = v as "auto" | "always" | "off"
            })
          }
        >
          <SelectTrigger id={GPS_GATE_KEY}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GPS_GATE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription>
          Gives the modem the whole start-up window: video recording and live
          streaming both wait until the device is connected with a GPS fix — or
          until it is clear one isn&rsquo;t coming (no cellular coverage, no view
          of the sky). Trip logs keep recording throughout.
        </FieldDescription>
      </Field>

      {recording.gpsGate !== "off" ? (
        <Field>
          <FieldLabel htmlFor={GPS_GATE_MAX_KEY}>Maximum GPS wait</FieldLabel>
          <Select
            value={String(recording.gpsGateMaxSecs)}
            disabled={isPending(GPS_GATE_MAX_KEY)}
            onValueChange={(v) =>
              commitRecording(GPS_GATE_MAX_KEY, (r) => {
                r.gpsGateMaxSecs = Number(v)
              })
            }
          >
            <SelectTrigger id={GPS_GATE_MAX_KEY}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {withCurrent(
                GPS_GATE_MAX_SECS_OPTIONS,
                recording.gpsGateMaxSecs
              ).map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s === 0
                    ? "No limit — wait as long as it takes"
                    : formatSeconds(s)}
                  {s === 600 ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            Video starts within this bound even if GPS never fixes. With no
            limit, video still starts as soon as the device gives up on a fix.
          </FieldDescription>
        </Field>
      ) : null}

      {recording.gpsGate !== "off" ? (
        <Field>
          <FieldLabel htmlFor={GPS_GATE_NO_PROGRESS_KEY}>
            Give up early if nothing is working
          </FieldLabel>
          <Select
            value={String(recording.gpsGateNoProgressSecs)}
            disabled={isPending(GPS_GATE_NO_PROGRESS_KEY)}
            onValueChange={(v) =>
              commitRecording(GPS_GATE_NO_PROGRESS_KEY, (r) => {
                r.gpsGateNoProgressSecs = Number(v)
              })
            }
          >
            <SelectTrigger id={GPS_GATE_NO_PROGRESS_KEY}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {withCurrent(
                GPS_GATE_NO_PROGRESS_SECS_OPTIONS,
                recording.gpsGateNoProgressSecs
              ).map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s === 0 ? "Off — only use the maximum wait" : formatSeconds(s)}
                  {s === 120 ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            For underground parking: if neither a GPS fix nor a cellular
            connection has arrived within this time, video starts anyway instead
            of waiting out the maximum. Never applies once the device is
            connected.
          </FieldDescription>
        </Field>
      ) : null}
    </div>
  )
}
