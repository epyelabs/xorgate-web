import type { Device, KvsChannel, MediaSession } from "@/lib/api"
import type { ManualWindow } from "@/lib/device-workflow-schemas"

// Display name for a device: its label falls back to the serial.
export function deviceLabel(d: Device): string {
  return d.name ?? d.serial
}

// The concrete test input a user binds to one source node in the simulator
// pane. Files keep a local object URL for in-browser playback/preview; at run
// time they are uploaded via the presigned-POST flow and the resulting S3 key
// is cached back onto the binding (`uploadKey`) so tweak-and-rerun cycles skip
// the re-upload. Webcam bindings (M5) upload nothing: once the run is live the
// capture publisher samples the camera and publishes JPEG frames to the run's
// ingest topic (use-webcam-ingest). Live device streams stay disabled until
// devices publish sampled frames.
export type SourceBinding =
  | { kind: "video-file"; file: File; url: string; name: string; uploadKey?: string }
  | {
      kind: "video-session"
      deviceId: string
      deviceName: string
      session: MediaSession
    }
  | {
      kind: "video-live"
      deviceId: string
      deviceName: string
      channel: KvsChannel
    }
  | { kind: "video-webcam"; name: string; deviceId?: string }
  | { kind: "csv-file"; file: File; name: string; uploadKey?: string }
  | {
      kind: "device-telemetry"
      deviceId: string
      deviceName: string
      window?: ManualWindow
    }

// Any binding that feeds a video source and can be previewed as video: an uploaded
// file, an on-device session, a live device stream, or the local webcam.
export type VideoBinding = Extract<
  SourceBinding,
  { kind: "video-file" | "video-session" | "video-live" | "video-webcam" }
>

// The mode dropdown options differ by source group: video sources pick a file, an
// on-device recording session, a live device stream, or the local webcam; sensor
// sources pick a CSV or a device's telemetry.
export type VideoMode = "file" | "sessions" | "live" | "webcam"
export type SensorMode = "csv" | "device"

// Video source catalog type; everything else in the "source" group is a sensor
// (telemetry). The catalog has exactly one abstract video source; its concrete
// feed (file / session / live / webcam) is what the mode dropdown binds.
export function isVideoSource(catalogType: string): boolean {
  return catalogType === "source.video"
}

export function isVideoBinding(b: SourceBinding): b is VideoBinding {
  return (
    b.kind === "video-file" ||
    b.kind === "video-session" ||
    b.kind === "video-live" ||
    b.kind === "video-webcam"
  )
}

// One-line label for the "bound" chip.
export function bindingLabel(b: SourceBinding): string {
  switch (b.kind) {
    case "video-file":
      return b.name
    case "video-session":
      return `${b.deviceName} · ${b.session.streamKey}`
    case "video-live":
      return `${b.deviceName} · ${b.channel.streamKey}`
    case "video-webcam":
      return b.name
    case "csv-file":
      return b.name
    case "device-telemetry":
      return b.deviceName
  }
}

export function formatBytes(bytes: number | null): string | null {
  if (bytes === null || bytes < 0) return null
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

// Short duration from seconds, e.g. "13.9s" or "1m 23s".
export function formatSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0s"
  if (sec < 60) return `${sec.toFixed(1)}s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return s ? `${m}m ${s}s` : `${m}m`
}

// The first bound video source (a vision graph may declare several), used to back
// the Video / Frames output tabs.
export function firstVideoBinding(
  bindings: Record<string, SourceBinding>,
): VideoBinding | null {
  for (const b of Object.values(bindings)) if (isVideoBinding(b)) return b
  return null
}

function formatDurationMs(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm ? `${h}h ${mm}m` : `${h}h`
}

// Total recorded duration of a session: the sum of its segments when the list
// endpoint rolled it up, else the wall-clock span. (Local twin of the one in
// components/session-pickers.tsx — that file may only export components.)
function sessionDurationMs(s: MediaSession): number | null {
  if (s.totalDurationMs > 0) return s.totalDurationMs
  if (s.endedAt) return new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()
  return null
}

// Secondary line for the "bound" chip: duration / size for media, or the window
// for a telemetry pick. Returns null when there's nothing extra to show.
export function bindingMeta(b: SourceBinding): string | null {
  switch (b.kind) {
    case "video-file":
    case "csv-file":
      return formatBytes(b.file.size)
    case "video-session": {
      const parts = [
        formatDurationMs(sessionDurationMs(b.session)),
        formatBytes(b.session.totalBytes),
        `${b.session.segmentCount} segment${b.session.segmentCount === 1 ? "" : "s"}`,
      ].filter(Boolean)
      return parts.length ? parts.join(" · ") : null
    }
    case "video-live":
      return `Live · ${b.channel.region}`
    case "video-webcam":
      return "Local camera"
    case "device-telemetry":
      if (!b.window) return null
      return b.window.mode === "lastN"
        ? `last ${b.window.n} readings`
        : "custom range"
  }
}

