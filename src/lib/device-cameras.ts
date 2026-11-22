// A camera sensor per port, console side (plans/support-other-camera-models,
// Phase 3): the pure rules behind the Camera sensors card on Settings > Media
// and the camera selects in Register device.
//
// Two planes meet on that card, the split every sibling card keeps:
//
//  - the `cameraSensors` NAMESPACE (desired + status): which sensor an operator
//    declared on each port. An ABSENT port key means "not managed": the device
//    leaves that port's line in config.txt exactly as it found it.
//  - the reported-only truth under `effective.cameras`: per port, what is
//    declared, what was detected, whether frames flow, and ONE verdict with
//    the device's own sentence. The console shows that sentence verbatim and
//    never composes a second explanation.
//
// All decisions live here, DOM-free, because the frontend vitest has no DOM;
// the components are thin renderers over these functions.
//
// This module deliberately imports nothing from `device-config-status.ts`:
// that module asks `cameraSensorsGate` for its "does not qualify" special
// case, and a lib importing its own importer would be a cycle.

import type {
  CameraSensorChoice,
  CameraSensorChoices,
  CameraSensorsConfig,
  Device,
  DeviceConfig,
  DeviceModel,
  DeviceRegistration,
  DeviceReportedConfig,
  IoCapabilities,
} from "@xorgate/sdk"
import {
  CAMERA_CATALOG,
  CAMERA_SENSOR_NONE,
  cameraSensor,
  cameraSensorByDetectedName,
  cameraSensorsMinAgent,
  type CameraCatalog,
  type CameraSensor,
} from "./camera-catalog"

/** The capability string an agent advertises when it acts on the namespace. */
export const CAMERA_SENSORS_CAPABILITY = "camera.sensors"

/**
 * The ONE pending key every control of the Camera sensors card saves under
 * (see `commitCameraSensors` in the settings hook): while it is pending the
 * whole card is disabled.
 */
export const CAMERA_SENSORS_SAVE_KEY = "device-camera-sensors"

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/** Own keys only: these maps are stored config and device-authored JSON. */
const own = (o: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, key)

const optionalString = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.slice(0, max) : null

// ---- the namespace ---------------------------------------------------------
// The wire types are the SDK's: `CameraSensorsConfig` (the namespace),
// `CameraSensorChoices` (its per-port map, also a registration's `cameras`)
// and `CameraSensorChoice` (one port).

/** The part of a device's config document these rules read. */
type SensorsConfig = Pick<DeviceConfig, "cameraSensors"> | null | undefined

/**
 * The per-port map of a stored namespace, RAW: entries are passed through as
 * found (unknown sensor ids, unknown option keys and all) so that a save can
 * carry them back unchanged. Only things that are not an entry at all (not an
 * object, no `sensor` string) are left out. `{}` for an absent namespace.
 *
 * Read tolerantly although the input is typed: the document comes from an API
 * that may be newer than this build, and a save built on it is replaced whole.
 */
export function storedCameraSensors(
  config: SensorsConfig
): CameraSensorChoices {
  const namespace: unknown = isPlainObject(config)
    ? config.cameraSensors
    : undefined
  const cameras = isPlainObject(namespace) ? namespace.cameras : undefined
  if (!isPlainObject(cameras)) return {}
  const out: CameraSensorChoices = {}
  for (const key of Object.keys(cameras)) {
    // Never a port (the API refuses it), and assigning it would not add a key.
    if (key === "__proto__") continue
    const entry = cameras[key]
    if (!isPlainObject(entry) || typeof entry.sensor !== "string") continue
    out[key] = entry as CameraSensorChoice
  }
  return out
}

/**
 * One port's stored declaration, or undefined when the port is not managed.
 * An OWN key only: the port name can come from a device report, and
 * `constructor` or `toString` must not find an inherited member.
 */
export function storedCameraSensor(
  config: SensorsConfig,
  port: string
): CameraSensorChoice | undefined {
  const stored = storedCameraSensors(config)
  return own(stored, port) ? stored[port] : undefined
}

export type CameraSensorChange =
  /** Declare a sensor (a catalog id) or an empty port (`none`). */
  | { port: string; sensor: string }
  /** Return the port to "not managed": the key is removed. */
  | { port: string; unmanaged: true }
  /**
   * Name one option of the sensor already declared on the port, or stop naming
   * it (`value: null`). An option the setting does not name is left as the
   * device's own `config.txt` line has it ("as found"), so "not named" and
   * "set to the default" are different declarations.
   */
  | { port: string; option: string; value: number | null }
  /**
   * Clear the whole namespace (`null`). For a value left behind on a device
   * whose model declares no camera ports: the API refuses every value there
   * and accepts exactly this.
   */
  | { clear: true }

/**
 * The WHOLE namespace to send for one change on one port. The backend replaces
 * `cameraSensors` whole on write, so everything the device should keep has to
 * be in the value:
 *
 *  - every OTHER port is carried through exactly as stored, including a
 *    sensor id or option this console build does not know (a newer catalog);
 *  - on the touched port, changing an option keeps the other options (known or
 *    not); un-naming one removes just that key, and `options` itself when it
 *    was the last; changing the sensor starts a fresh entry, because options
 *    belong to the sensor they were set for;
 *  - a port the device's model no longer declares (left behind by a model
 *    reassignment) is dropped: the backend refuses a save that carries one,
 *    so keeping it would make the card unsaveable. `ports: null` = the model's
 *    ports are unknown, so nothing is pruned.
 *
 * `null` when no port is left managed: the namespace is cleared rather than
 * stored as an empty map, so the card reads "nothing managed", not "synced".
 */
export function buildCameraSensorsConfig(
  storedConfig: SensorsConfig,
  change: CameraSensorChange,
  opts: { ports?: readonly string[] | null } = {}
): CameraSensorsConfig | null {
  if ("clear" in change) return null
  const stored = storedCameraSensors(storedConfig)
  const ports = opts.ports ?? null
  const cameras: CameraSensorChoices = {}
  for (const key of Object.keys(stored)) {
    if (ports !== null && !ports.includes(key)) continue
    cameras[key] = stored[key]
  }

  const current = own(cameras, change.port) ? cameras[change.port] : undefined
  if ("unmanaged" in change) {
    delete cameras[change.port]
  } else if ("sensor" in change) {
    // Re-selecting the stored sensor is not a change: its options survive.
    if (current?.sensor !== change.sensor)
      cameras[change.port] = { sensor: change.sensor }
  } else if (current !== undefined && current.sensor !== CAMERA_SENSOR_NONE) {
    const options: Record<string, number> = {
      ...(isPlainObject(current.options) ? current.options : {}),
    }
    if (change.value === null) delete options[change.option]
    else options[change.option] = change.value
    const next: CameraSensorChoice = { ...current }
    if (Object.keys(options).length > 0) next.options = options
    else delete next.options
    cameras[change.port] = next
  }
  return Object.keys(cameras).length > 0 ? { cameras } : null
}

// ---- who may hold the namespace --------------------------------------------

export type CameraSensorsGate =
  | { allowed: true }
  | {
      allowed: false
      reason: "simulated" | "agent-kind" | "agent-version"
      /** One line for the card: which agent is needed to choose a sensor. */
      message: string
    }

/**
 * Whether this device may hold `cameraSensors`: the backend's own gate, so the
 * card never offers a control the API would refuse with a 400. Allowed for a
 * real (not simulated) device running the Rust agent that either has never
 * reported or advertises `camera.sensors`. Fails closed on what it cannot read.
 */
export function cameraSensorsGate(
  device:
    | Pick<Device, "simulated" | "agent" | "agentVersion" | "reportedConfig">
    | null
    | undefined,
  catalog: CameraCatalog = CAMERA_CATALOG
): CameraSensorsGate {
  const need = cameraSensorsMinAgent(catalog)
  if (!device || device.simulated !== false) {
    return {
      allowed: false,
      reason: "simulated",
      message:
        "A simulated device has no camera ports, so there is no sensor to choose.",
    }
  }
  if (device.agent !== "rust") {
    const runs =
      device.agent === "js"
        ? "the JS agent"
        : `the ${String(device.agent)} agent`
    return {
      allowed: false,
      reason: "agent-kind",
      message:
        `Choosing a camera sensor needs the Rust agent, version ${need} or newer. ` +
        `This device runs ${runs}.`,
    }
  }
  // A Rust device that has never reported may hold a choice (the one made in
  // Register device); the first report settles it.
  if (device.reportedConfig === null || device.reportedConfig === undefined) {
    return { allowed: true }
  }
  if (
    reportedCapabilities(device.reportedConfig).includes(
      CAMERA_SENSORS_CAPABILITY
    )
  ) {
    return { allowed: true }
  }
  const build = optionalString(device.agentVersion, 64)
  return {
    allowed: false,
    reason: "agent-version",
    message:
      `Choosing a camera sensor needs Rust agent ${need} or newer. ` +
      (build
        ? `This device last reported agent build ${build}; update the agent, then choose a sensor here.`
        : "This device's agent has not reported that it supports it; update the agent, then choose a sensor here."),
  }
}

/**
 * A settings patch without its `cameraSensorsConfig` key when the device may
 * not hold the namespace. The API refuses it there with a 400, `null`
 * (revert) included, and that would fail whatever else the patch carries. No
 * control offers the key for such a device; this is the save layer's own
 * guard, so a patch that touches several namespaces at once (a revert of
 * everything, say) still goes through for the namespaces the device does hold.
 */
export function withoutUnheldCameraSensors<
  T extends { cameraSensorsConfig?: unknown },
>(device: Parameters<typeof cameraSensorsGate>[0], patch: T): T {
  if (!("cameraSensorsConfig" in patch) || cameraSensorsGate(device).allowed)
    return patch
  const rest = { ...patch }
  delete rest.cameraSensorsConfig
  return rest
}

/** `effective` of a stored report, or `{}`. Device-authored: never trusted. */
function reportedEffective(reportedConfig: unknown): Record<string, unknown> {
  if (!isPlainObject(reportedConfig)) return {}
  return isPlainObject(reportedConfig.effective) ? reportedConfig.effective : {}
}

function reportedCapabilities(reportedConfig: unknown): unknown[] {
  const agent = reportedEffective(reportedConfig).agent
  if (!isPlainObject(agent)) return []
  return Array.isArray(agent.capabilities) ? agent.capabilities : []
}

// ---- ports -----------------------------------------------------------------

export interface CameraPort {
  /** Stream key (`cam0`): the key of the namespace and of the report. */
  key: string
  connector: string | null
  /** The model's `sensor`: the DEFAULT the console pre-selects, nothing more. */
  defaultSensor: string | null
}

/**
 * The camera ports a model declares, in model order, or `null` when the model
 * has no v2 hardware block: its ports are then unknown and the backend refuses
 * the namespace for it.
 */
export function modelCameraPorts(
  caps: IoCapabilities | null | undefined
): CameraPort[] | null {
  if (!caps || caps.schemaVersion !== 2) return null
  const video = caps.media?.video
  if (!Array.isArray(video)) return []
  const ports: CameraPort[] = []
  for (const entry of video as unknown[]) {
    if (
      !isPlainObject(entry) ||
      typeof entry.key !== "string" ||
      entry.key.length === 0
    )
      continue
    if (ports.some((p) => p.key === entry.key)) continue
    ports.push({
      key: entry.key,
      connector: optionalString(entry.connector, 32),
      defaultSensor: optionalString(entry.sensor, 32),
    })
  }
  return ports
}

/**
 * The ports the Register dialog offers a camera select for.
 *
 * With a model picked: that model's ports, each pre-set from its `sensor`.
 * On "Automatic" the model is only known at claim, so the dialog offers the
 * ports of every model that declares any (a choice for a port the resolved
 * model lacks is dropped by the claim), and pre-sets one only when every model
 * that has that port agrees on its sensor.
 */
export function registrationCameraPorts(
  models:
    | readonly Pick<DeviceModel, "id" | "ioCapabilities">[]
    | null
    | undefined,
  modelPick: string
): CameraPort[] {
  const all = models ?? []
  if (modelPick !== "auto") {
    const picked = all.find((m) => m.id === modelPick)
    return modelCameraPorts(picked?.ioCapabilities) ?? []
  }
  const merged: CameraPort[] = []
  const disagree = new Set<string>()
  for (const model of all) {
    for (const port of modelCameraPorts(model.ioCapabilities) ?? []) {
      const seen = merged.find((p) => p.key === port.key)
      if (!seen) merged.push({ ...port })
      else if (seen.defaultSensor !== port.defaultSensor) disagree.add(port.key)
    }
  }
  return merged
    .map((p) =>
      disagree.has(p.key) ? { ...p, defaultSensor: null, connector: null } : p
    )
    .sort((a, b) => a.key.localeCompare(b.key))
}

// ---- registrations ---------------------------------------------------------

/**
 * What a registration says about cameras.
 *
 * `supported: false` = the answer has no `cameras` key at all, which is a
 * backend from before the feature (it would ignore a choice): the dialog then
 * offers no camera select. A backend with the feature always sends the key on
 * a Rust registration, as the map or `null`. (`reg.cameras !== undefined` is
 * the SDK's documented feature test.)
 */
export function registrationCameras(
  reg: Partial<DeviceRegistration> | null | undefined
): {
  supported: boolean
  cameras: CameraSensorChoices
} {
  if (!isPlainObject(reg) || reg.cameras === undefined)
    return { supported: false, cameras: {} }
  return {
    supported: true,
    cameras: storedCameraSensors(
      reg.cameras === null ? {} : { cameraSensors: { cameras: reg.cameras } }
    ),
  }
}

/**
 * The `cameras` value to re-pin when one port's select changes: the choice the
 * registration already carries (entries as stored), with that one port set.
 * Ports nobody touched stay absent, so the claim seeds them from the model
 * that is finally resolved.
 */
export function nextRegistrationCameras(
  current: CameraSensorChoices,
  port: string,
  sensor: string
): CameraSensorChoices {
  const next: CameraSensorChoices = {}
  for (const key of Object.keys(current)) next[key] = current[key]
  if (!own(next, port) || next[port].sensor !== sensor) next[port] = { sensor }
  return next
}

// ---- the reported truth ----------------------------------------------------

/**
 * One port of `reportedConfig.effective.cameras`, read defensively. Every
 * field is nullable: the block is device-authored, an agent older or newer
 * than this build may send a sparser or richer shape, and the verdict and
 * state vocabularies may grow.
 */
export interface ReportedCamera {
  port: string
  connector: string | null
  /** What the device takes as declared, and where from, or null when nothing. */
  declared: { sensor: string | null; source: string | null } | null
  /** The sensor name libcamera listed on the port (`imx708_wide`), or null. */
  detected: string | null
  /** The device-tree node the driver sits on (`imx708@1a`), or null. */
  node: string | null
  /** Capture state word (`streaming`, `starting`, `failing`, `absent`, `off`…). */
  capture: string | null
  /** The verdict word. Unknown members are kept as sent. */
  verdict: string | null
  /** The device's own sentence about this port. Shown verbatim. */
  detail: string | null
}

/** Bounds on a device-authored block: enough for any real device, no more. */
const MAX_REPORTED_PORTS = 8
const MAX_DETAIL_CHARS = 1000

/**
 * `effective.cameras` as a list in the device's own order. A missing block, a
 * block of the wrong type, or an entry that is not an object yields nothing
 * for it; it never throws inside a render.
 *
 * The block is read off the SDK's `reportedConfig.effective.cameras`, and
 * then parsed as if it were untyped. The SDK's `DeviceReportedCamera` is the
 * shape a conforming agent sends; nothing validates it in transit, and this
 * page renders a fleet of mixed agent versions.
 */
export function parseReportedCameras(
  reportedConfig: DeviceReportedConfig | null | undefined
): ReportedCamera[] {
  const effective = isPlainObject(reportedConfig)
    ? reportedConfig.effective
    : undefined
  const block: unknown = isPlainObject(effective)
    ? effective.cameras
    : undefined
  if (!isPlainObject(block)) return []
  const out: ReportedCamera[] = []
  for (const port of Object.keys(block)) {
    if (out.length >= MAX_REPORTED_PORTS) break
    const raw = block[port]
    if (!isPlainObject(raw) || port.length === 0 || port.length > 64) continue
    const declared = isPlainObject(raw.declared)
      ? {
          sensor: optionalString(raw.declared.sensor, 64),
          source: optionalString(raw.declared.source, 32),
        }
      : null
    const bound = isPlainObject(raw.bound) ? raw.bound : {}
    const capture = isPlainObject(raw.capture) ? raw.capture : {}
    out.push({
      port,
      connector: optionalString(raw.connector, 32),
      declared,
      detected: optionalString(bound.listed, 64),
      node: optionalString(bound.node, 64),
      capture: optionalString(capture.state, 32),
      verdict: optionalString(raw.verdict, 48),
      detail: optionalString(raw.detail, MAX_DETAIL_CHARS),
    })
  }
  return out
}

export type CameraVerdictTone =
  /** Declared, detected, frames flowing. */
  | "ok"
  /** Nothing is wrong; the operator has one thing left to do (reboot). */
  | "action"
  /** The port does not work as declared. */
  | "problem"
  /** Nothing to judge: an empty or unchecked port, or a word this build does not know. */
  | "neutral"

const VERDICTS: Record<string, { label: string; tone: CameraVerdictTone }> = {
  ok: { label: "Working", tone: "ok" },
  "reboot-required": { label: "Reboot required", tone: "action" },
  mismatch: { label: "Mismatch", tone: "problem" },
  "not-detected": { label: "Not detected", tone: "problem" },
  "no-frames": { label: "No frames", tone: "problem" },
  "requirements-missing": { label: "Requirements missing", tone: "problem" },
  "unknown-sensor": { label: "Unknown sensor", tone: "problem" },
  empty: { label: "No camera", tone: "neutral" },
  unchecked: { label: "Not checked", tone: "neutral" },
}

/** The verdict that tells the operator to reboot. */
export const VERDICT_REBOOT_REQUIRED = "reboot-required"

/**
 * The agent's `adjusted` detail for "delivered, but the reconciler has not
 * looked at it yet": a moment right after a save, not a disagreement.
 */
export const CAMERA_SENSORS_NOT_RECONCILED_DETAIL =
  "saved; the device has not reconciled its boot config yet"

/**
 * Whether the device holds the namespace but has not reconciled its boot
 * config with it yet. The agent says so twice: `effective.cameraSensors`
 * carries `reconciled: false` until the first pass, and the status entry is
 * `adjusted` with the sentence above. Either is enough; the page then shows
 * the namespace as still applying rather than as adjusted.
 */
export function cameraSensorsNotReconciled(
  effective: unknown,
  detail: string | undefined
): boolean {
  if (isPlainObject(effective) && effective.reconciled === false) return true
  return detail === CAMERA_SENSORS_NOT_RECONCILED_DETAIL
}

/**
 * Whether the namespace's own callout would only repeat what the ports
 * already say, so that each thing is said once. Two cases:
 *
 *  - the status is `adjusted` because the boot config was written and waits
 *    for a reboot (the device marks that sentence "REBOOT REQUIRED", as it
 *    does for `cameraMount`), some port reads `reboot-required` in the
 *    device's words, and no port reports a fault;
 *  - the callout's sentence is, word for word, a sentence a port already
 *    shows (with or without the `camN: ` the status puts in front of it).
 *
 * A port in trouble keeps the callout: a sensor whose requirements are
 * missing, or one that is not detected, can ALSO be waiting for a reboot, and
 * then the callout is the only place that names every port that waits.
 * Anything this cannot tell apart shows both, which is the harmless side.
 */
export function cameraSensorsCalloutRepeatsPorts(
  status: { state: string; detail?: string; reason?: string },
  cameras: readonly ReportedCamera[]
): boolean {
  const sentence = (
    status.state === "rejected"
      ? (status.reason ?? status.detail)
      : status.state === "adjusted"
        ? (status.detail ?? status.reason)
        : undefined
  )?.trim()
  if (sentence) {
    for (const camera of cameras) {
      // Only a sentence the port actually SHOWS can stand in for the callout.
      const shown = cameraPortTruth(camera, false).sentence?.trim()
      if (!shown) continue
      if (shown === sentence || `${camera.port}: ${shown}` === sentence)
        return true
    }
  }
  if (status.state !== "adjusted") return false
  if (!/reboot required/i.test(status.detail ?? "")) return false
  let waits = false
  for (const camera of cameras) {
    if (camera.verdict === VERDICT_REBOOT_REQUIRED) waits = true
    else if (cameraVerdict(camera.verdict)?.tone === "problem") return false
  }
  return waits
}

/**
 * The ONE state indicator of a port, derived from its verdict. A verdict this
 * build does not know (the vocabulary may grow) is shown under its own word,
 * neutrally: the device's sentence below it still says what it means.
 */
export function cameraVerdict(
  verdict: string | null
): { label: string; tone: CameraVerdictTone } | null {
  if (verdict === null) return null
  if (own(VERDICTS, verdict)) return VERDICTS[verdict]
  const words = verdict.replace(/[-_]+/g, " ").trim()
  if (words.length === 0) return null
  return {
    label: words.charAt(0).toUpperCase() + words.slice(1),
    tone: "neutral",
  }
}

const DECLARED_SOURCES: Record<string, string> = {
  config: "this setting",
  "boot-config": "config.txt",
  model: "device model",
}

const CAPTURE_STATES: Record<string, string> = {
  streaming: "Flowing",
  starting: "Starting",
  failing: "Failing",
  absent: "None",
  off: "Off",
}

/**
 * The three facts beside the verdict: what is declared, what was detected,
 * whether frames flow. Facts only, in a word or two each, in the device's own
 * names (`imx708_wide`), since that is what an operator will find in the
 * device's logs; the explanation is the device's `detail`. Unknown words are
 * shown as sent.
 */
export function reportedCameraFacts(camera: ReportedCamera): {
  declared: string
  detected: string
  frames: string
} {
  let declared = "—"
  const sensor = camera.declared?.sensor
  if (sensor) {
    const source = camera.declared?.source
    const from = source
      ? ` · ${own(DECLARED_SOURCES, source) ? DECLARED_SOURCES[source] : source}`
      : ""
    declared = `${sensor === CAMERA_SENSOR_NONE ? "No camera" : sensor}${from}`
  }
  const state = camera.capture
  return {
    declared,
    detected: camera.detected ?? "None",
    frames:
      state === null
        ? "—"
        : own(CAPTURE_STATES, state)
          ? CAPTURE_STATES[state]
          : state,
  }
}

/**
 * The indicator of an `ok` port whose capture is NOT streaming, by capture
 * state. The device's verdict is `ok` whenever the right sensor is detected,
 * which also covers a camera that is switched off in settings and one whose
 * capture has not started yet (a minute or more after a boot on a device with
 * a boot gate). "Working" would be untrue for both.
 */
const OK_NOT_STREAMING_LABELS: Record<string, string> = {
  off: "Off",
  starting: "Starting",
}

/**
 * What a port's row shows of the device's truth, said once.
 *
 *  - A healthy port (`ok`, capture `streaming`) shows the detected sensor name
 *    beside "Working", and a deliberately empty one (`empty`) its indicator.
 *    No sentence and no facts: they would say "working" three more ways.
 *  - An `ok` port that is not streaming is detected, not working: a neutral
 *    indicator named after the capture state ("Off", "Starting", otherwise
 *    "Detected"), the detected sensor name, and the device's own sentence,
 *    which says why. No facts.
 *  - A port that only waits for a reboot (`reboot-required`) shows the
 *    indicator and the device's sentence. Nothing is wrong with it, and what
 *    is detected now belongs to the line the device booted with, so the facts
 *    would read "None / None" under a sentence that already says what to do.
 *  - Any other verdict shows the indicator, the device's own sentence and the
 *    facts, which are what an operator diagnoses with. "Declared" is left out
 *    when the port is managed, because the select above already shows it; on
 *    an unmanaged port it is the only place config.txt's sensor appears.
 */
export function cameraPortTruth(
  camera: ReportedCamera | null,
  managed: boolean
): {
  verdict: { label: string; tone: CameraVerdictTone } | null
  /** The detected sensor name, for an `ok` port only. */
  detected: string | null
  sentence: string | null
  facts: { label: "Declared" | "Detected" | "Frames"; value: string }[]
} {
  if (camera === null)
    return { verdict: null, detected: null, sentence: null, facts: [] }
  const verdict = cameraVerdict(camera.verdict)
  if (camera.verdict === "empty") {
    return { verdict, detected: null, sentence: null, facts: [] }
  }
  if (camera.verdict === "ok") {
    if (camera.capture === "streaming") {
      return { verdict, detected: camera.detected, sentence: null, facts: [] }
    }
    const state = camera.capture
    const label =
      state !== null && own(OK_NOT_STREAMING_LABELS, state)
        ? OK_NOT_STREAMING_LABELS[state]
        : "Detected"
    return {
      verdict: { label, tone: "neutral" },
      detected: camera.detected,
      sentence: camera.detail,
      facts: [],
    }
  }
  const facts: { label: "Declared" | "Detected" | "Frames"; value: string }[] =
    []
  // A block with none of the three facts in it (only a verdict, or a shape
  // this build cannot read) gets no row of dashes.
  if (
    camera.verdict !== VERDICT_REBOOT_REQUIRED &&
    (camera.declared?.sensor || camera.detected || camera.capture)
  ) {
    const all = reportedCameraFacts(camera)
    if (!managed) facts.push({ label: "Declared", value: all.declared })
    facts.push({ label: "Detected", value: all.detected })
    facts.push({ label: "Frames", value: all.frames })
  }
  return { verdict, detected: null, sentence: camera.detail, facts }
}

/**
 * The Camera mounting switch for a port whose sensor may not flip.
 *
 * `cannotRotate`: the catalog says the sensor applies no flip, so the line
 * "This sensor cannot be rotated." is shown. `locked`: the switch is disabled.
 * It is locked only while it is OFF. A 180 stored before the port got such a
 * sensor is refused by the device, and turning the switch off is the only way
 * to clear it from the console, so a switch that is on always stays operable.
 */
export function cameraRotationSwitch(
  sensor: Pick<CameraSensor, "canFlip"> | undefined,
  storedDeg: number | undefined
): { cannotRotate: boolean; locked: boolean } {
  const cannotRotate = sensor?.canFlip === false
  return { cannotRotate, locked: cannotRotate && storedDeg !== 180 }
}

/**
 * The sensor the console takes to be on a port, for the catalog facts that
 * follow from it (can it rotate, which presets it cannot run): what the cloud
 * holds for the port, else what the device says is declared, else what it
 * detected. Undefined when none of them names a sensor this build knows; an
 * empty port (`none`) has no sensor.
 */
export function portSensor(
  port: string,
  storedConfig: SensorsConfig,
  reported: readonly ReportedCamera[],
  catalog: CameraCatalog = CAMERA_CATALOG
): CameraSensor | undefined {
  const stored = storedCameraSensors(storedConfig)
  if (own(stored, port)) {
    if (stored[port].sensor === CAMERA_SENSOR_NONE) return undefined
    const sensor = cameraSensor(stored[port].sensor, catalog)
    if (sensor) return sensor
  }
  const camera = reported.find((c) => c.port === port)
  if (!camera) return undefined
  return (
    cameraSensor(camera.declared?.sensor, catalog) ??
    cameraSensorByDetectedName(camera.declared?.sensor, catalog) ??
    cameraSensorByDetectedName(camera.detected, catalog) ??
    cameraSensorByDetectedName(camera.node, catalog)
  )
}
