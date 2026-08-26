// Device config defaults + namespace builders, in ONE place.
//
// Every default here now comes from `config-contract.json` — the artifact the
// backend's config registry generates (`npm run contract:generate` in
// backend/xorgate-core-service) and commits into all three packages. The
// backend test regenerates and diffs it, and the device agent contract-tests
// its own constants against the same file, so "what the UI shows for an
// unconfigured device" and "what the device actually does" cannot drift apart
// without a test failing. Before this they were hand-copies, and the
// thermal-shed keys shipped missing from three of five places.
//
// Do NOT re-inline a default anywhere else: change it in the backend registry
// and regenerate.

import contract from "@/lib/config-contract.json"
import type { CameraMountConfig, RecordingConfig } from "@xorgate/sdk"
import type { ImuMount, ImuView, VideoPresetName } from "@/lib/xorgate"

export const GIB = 1024 ** 3

/**
 * Every namespace's device defaults, keyed by WIRE name — the exact values the
 * device resolves when a key is absent from settings.json, straight off the
 * contract artifact.
 *
 * Separate from the named constants below because one caller
 * (`device-config-status.ts`) needs to ask the question generically: "is the
 * value this device reports as in force anything other than the default?".
 * Hand-copying a default to answer that is the drift the registry exists to
 * prevent.
 */
export const CONFIG_NAMESPACE_DEFAULTS: Readonly<Record<string, unknown>> =
  Object.fromEntries(
    Object.entries(contract.namespaces).map(([ns, spec]) => [ns, spec.defaults])
  )

/** The two rotations the camera overlay accepts, from the SDK's generated type. */
export type CameraRotationDeg = CameraMountConfig["cameras"][string]["rotationDeg"]

/**
 * The rotation each camera is CONFIGURED to, from the stored namespace.
 *
 * An absent key is deliberately absent from the result too, not 0: on the
 * device an absent camera is UNMANAGED (its boot config is left exactly as
 * found), so a control that rendered it as "0, upright" would claim the cloud
 * is holding something it is not. The UI shows the switch off either way; the
 * difference only matters when writing, which is why the writer always sends
 * an explicit rotation.
 */
export function resolveCameraMount(config: unknown): Record<string, CameraRotationDeg> {
  const cameras =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as { cameras?: unknown }).cameras
      : undefined
  if (!cameras || typeof cameras !== "object" || Array.isArray(cameras)) return {}
  const out: Record<string, CameraRotationDeg> = {}
  for (const [key, entry] of Object.entries(cameras as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue
    const deg = (entry as { rotationDeg?: unknown }).rotationDeg
    if (deg === 0 || deg === 180) out[key] = deg
  }
  return out
}

const RECORDING = contract.namespaces.recording.defaults
const SHED = RECORDING.powerShedding
const VIDEO = RECORDING.video

// Defaults shown when the device has no stored settings yet.
export const DEFAULT_IMU_MOUNT: ImuMount = contract.namespaces.imuMount.defaults
export const DEFAULT_IMU_VIEW: ImuView = contract.uiPrefs.defaults.imuView

// Device defaults for the namespaces the UI does not own a column for.
export const DEFAULT_LTE_GPS_FIX_RESET_POLICY =
  contract.namespaces.lteRecovery.defaults.gpsFixResetPolicy
export const DEFAULT_LTE_DEADZONE_PROFILE =
  contract.namespaces.lteRecovery.defaults.deadZoneProfile
export const DEFAULT_TIME_SYNC_OFFLINE_SOURCES =
  contract.namespaces.timeSync.defaults.offlineSources

// The contract publishes plain JSON, so string defaults widen to `string`. The
// backend's own contract test asserts every default is a member of its schema's
// enum, which is the guarantee these two casts stand on.
const DEFAULT_PRESET = VIDEO.preset as VideoPresetName
const DEFAULT_BOOT_DEFER = VIDEO.bootDefer as "auto" | "always" | "off"
const DEFAULT_GPS_GATE = VIDEO.gpsGate as "auto" | "always" | "off"
const DEFAULT_UPLOAD_MODE = RECORDING.upload.mode as "auto" | "off"

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
  // Thermal arm thresholds (power_management_improvements plan).
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
    telemetryEnabled: cfg?.telemetry?.enabled ?? RECORDING.telemetry.enabled,
    rateHz: cfg?.telemetry?.rateHz ?? RECORDING.telemetry.rateHz,
    videoEnabled: cfg?.video?.enabled ?? VIDEO.enabled,
    preset: cfg?.video?.preset ?? DEFAULT_PRESET,
    segmentSeconds: cfg?.video?.segmentSeconds ?? VIDEO.segmentSeconds,
    bootDefer: cfg?.video?.bootDefer ?? DEFAULT_BOOT_DEFER,
    bootDeferMaxSecs: cfg?.video?.bootDeferMaxSecs ?? VIDEO.bootDeferMaxSecs,
    // Deliberately NOT defaulted: the UI doesn't edit these two, and
    // buildRecordingConfig only re-sends them when they are already stored.
    // Defaulting them here would materialize them into every saved config.
    bootDeferMinBudgetMa: cfg?.video?.bootDeferMinBudgetMa,
    gpsGate: cfg?.video?.gpsGate ?? DEFAULT_GPS_GATE,
    gpsGateMaxSecs: cfg?.video?.gpsGateMaxSecs ?? VIDEO.gpsGateMaxSecs,
    gpsGateNoProgressSecs:
      cfg?.video?.gpsGateNoProgressSecs ?? VIDEO.gpsGateNoProgressSecs,
    spawnStaggerSecs: cfg?.video?.spawnStaggerSecs,
    cameras: cfg?.video?.cameras ?? VIDEO.cameras,
    uploadMode: cfg?.upload?.mode ?? DEFAULT_UPLOAD_MODE,
    maxBytes: cfg?.retention?.maxBytes ?? RECORDING.retention.maxBytes,
    minFreeBytes: cfg?.retention?.minFreeBytes,
    powerSheddingEnabled: cfg?.powerShedding?.enabled ?? SHED.enabled,
    cpuTempC: cfg?.powerShedding?.cpuTempC ?? SHED.cpuTempC,
    cpuTempRestoreC: cfg?.powerShedding?.cpuTempRestoreC ?? SHED.cpuTempRestoreC,
    cpuTempSecs: cfg?.powerShedding?.cpuTempSecs ?? SHED.cpuTempSecs,
    powerShedding: cfg?.powerShedding,
  }
}

// A save always sends the complete namespace so the stored config (and the
// retained copy the device converges on) is self-contained after first touch —
// the backend replaces a namespace whole, exactly as the device does.
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
