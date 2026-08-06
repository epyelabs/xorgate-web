// Device config defaults + namespace builders, in ONE place.
//
// ⚠️ TEMPORARY BY DESIGN. Every default in this file is a hand-copy of the
// device agent's own defaults (device/xorgate-device-agent: RECORDING_DEFAULTS
// in src/recording/config.ts, and the settings.json parser). A device with a
// null config renders what it is actually doing only for as long as the two
// copies agree — and they have drifted before (the thermal-shed keys shipped
// missing from three of five places).
//
// Phase 2 of the "improve device settings management" plan replaces this module
// with the generated `config-contract.json` artifact emitted by the backend
// config registry (defaults + bounds + enums, imported here, contract-tested on
// the device). Until then: this file is the single scatter site. Do NOT
// re-inline a default anywhere else — add it here.

import type { ImuMount, ImuView, RecordingConfig, VideoPresetName } from "@/lib/api"

export const GIB = 1024 ** 3

// Defaults shown when the device has no stored IMU settings yet. The camera
// numbers mirror the orientation view's built-in 3/4 angle.
export const DEFAULT_IMU_MOUNT: ImuMount = {
  enabled: false,
  rollDeg: 0,
  pitchDeg: 0,
  yawDeg: 0,
}
export const DEFAULT_IMU_VIEW: ImuView = { azimuthDeg: 45, elevationDeg: 24 }

// Device defaults for the namespaces the UI does not own a column for.
export const DEFAULT_LTE_GPS_FIX_RESET_POLICY = "defer"
export const DEFAULT_LTE_DEADZONE_PROFILE = "balanced"
export const DEFAULT_TIME_SYNC_OFFLINE_SOURCES = true

export interface ResolvedRecording {
  telemetryEnabled: boolean
  rateHz: number
  videoEnabled: boolean
  preset: VideoPresetName
  segmentSeconds: number
  bootDefer: "auto" | "always" | "off"
  bootDeferMaxSecs: number
  bootDeferMinBudgetMa: number | undefined
  gpsGate: "auto" | "always" | "off"
  gpsGateMaxSecs: number
  gpsGateNoProgressSecs: number
  spawnStaggerSecs: number | undefined
  // Per-camera enables keyed by stream key (Phase 6). An absent key means the
  // camera is on, so this only ever carries explicit choices.
  cameras: Record<string, boolean>
  uploadMode: "auto" | "off"
  maxBytes: number
  minFreeBytes: number | undefined
  powerSheddingEnabled: boolean
  // Thermal arm thresholds (power_management_improvements plan). Defaults
  // mirror the device agent's RECORDING_DEFAULTS, so an untouched device shows
  // what it is actually doing rather than a blank control.
  cpuTempC: number
  cpuTempRestoreC: number
  cpuTempSecs: number
  // Raw namespace, preserved verbatim: the REMAINING threshold knobs (rail,
  // escalation, cycle cap) are edited via the API / field-tuning loop, not
  // this card.
  powerShedding: RecordingConfig["powerShedding"]
}

export function resolveRecording(cfg: RecordingConfig | null): ResolvedRecording {
  return {
    telemetryEnabled: cfg?.telemetry?.enabled ?? false,
    rateHz: cfg?.telemetry?.rateHz ?? 10,
    videoEnabled: cfg?.video?.enabled ?? false,
    preset: cfg?.video?.preset ?? "1080p15-2mbps",
    segmentSeconds: cfg?.video?.segmentSeconds ?? 60,
    bootDefer: cfg?.video?.bootDefer ?? "auto",
    bootDeferMaxSecs: cfg?.video?.bootDeferMaxSecs ?? 90,
    bootDeferMinBudgetMa: cfg?.video?.bootDeferMinBudgetMa,
    gpsGate: cfg?.video?.gpsGate ?? "auto",
    gpsGateMaxSecs: cfg?.video?.gpsGateMaxSecs ?? 600,
    gpsGateNoProgressSecs: cfg?.video?.gpsGateNoProgressSecs ?? 120,
    spawnStaggerSecs: cfg?.video?.spawnStaggerSecs,
    cameras: cfg?.video?.cameras ?? {},
    uploadMode: cfg?.upload?.mode ?? "auto",
    maxBytes: cfg?.retention?.maxBytes ?? 10 * GIB,
    minFreeBytes: cfg?.retention?.minFreeBytes,
    powerSheddingEnabled: cfg?.powerShedding?.enabled ?? true,
    cpuTempC: cfg?.powerShedding?.cpuTempC ?? 80,
    cpuTempRestoreC: cfg?.powerShedding?.cpuTempRestoreC ?? 70,
    cpuTempSecs: cfg?.powerShedding?.cpuTempSecs ?? 15,
    powerShedding: cfg?.powerShedding,
  }
}

// The PUT always sends the complete namespace so the stored config (and the
// retained copy the device converges on) is self-contained after first touch.
export function buildRecordingConfig(r: ResolvedRecording): RecordingConfig {
  return {
    telemetry: { enabled: r.telemetryEnabled, rateHz: r.rateHz },
    video: {
      enabled: r.videoEnabled,
      preset: r.preset,
      segmentSeconds: r.segmentSeconds,
      bootDefer: r.bootDefer,
      bootDeferMaxSecs: r.bootDeferMaxSecs,
      gpsGate: r.gpsGate,
      gpsGateMaxSecs: r.gpsGateMaxSecs,
      gpsGateNoProgressSecs: r.gpsGateNoProgressSecs,
      // Preserve threshold knobs someone set out-of-band (API / field-tuning
      // loop); the UI doesn't edit them.
      ...(r.bootDeferMinBudgetMa !== undefined
        ? { bootDeferMinBudgetMa: r.bootDeferMinBudgetMa }
        : {}),
      ...(r.spawnStaggerSecs !== undefined
        ? { spawnStaggerSecs: r.spawnStaggerSecs }
        : {}),
      cameras: r.cameras,
    },
    upload: { mode: r.uploadMode },
    retention: {
      maxBytes: r.maxBytes,
      // Preserve a minFreeBytes someone set out-of-band; the UI doesn't edit it.
      ...(r.minFreeBytes !== undefined ? { minFreeBytes: r.minFreeBytes } : {}),
    },
    // Preserve shedding thresholds set out-of-band (field-tuning loop); the UI
    // edits the master switch and the thermal arm, and the spread carries the
    // rest through untouched. A key no form knows about but the zod schema
    // keeps is a key preserved; one the schema strips is one this save would
    // silently delete, which is why lib/schemas.ts lists them all.
    powerShedding: {
      ...(r.powerShedding ?? {}),
      enabled: r.powerSheddingEnabled,
      cpuTempC: r.cpuTempC,
      cpuTempRestoreC: r.cpuTempRestoreC,
      cpuTempSecs: r.cpuTempSecs,
    },
  }
}
