import { describe, expect, it } from "vitest"
import type { Device, DeviceModel, IoCapabilities } from "@xorgate/sdk"
import { parseCameraCatalog } from "./camera-catalog"
import {
  buildCameraSensorsConfig,
  cameraSensorsGate,
  cameraVerdict,
  modelCameraPorts,
  nextRegistrationCameras,
  parseReportedCameras,
  portSensor,
  registrationCameraPorts,
  registrationCameras,
  reportedCameraFacts,
  storedCameraSensors,
  withoutUnheldCameraSensors,
} from "./device-cameras"

// The rules behind the Camera sensors card and the Register dialog's camera
// selects (plans/support-other-camera-models, Phase 3). Two things here are
// load-bearing for devices in the field:
//
//  - a save sends the WHOLE namespace (the backend replaces it whole), so the
//    builder must carry every other port and every value this console build
//    does not know;
//  - the report block is device-authored and its vocabularies may grow, so the
//    parser must render something sensible for anything, and never throw.

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: "dev-1",
    status: "online",
    agent: "rust",
    agentVersion: null,
    simulated: false,
    config: {},
    configRev: 0,
    reportedConfig: null,
    reportedAt: null,
    ...overrides,
  } as Device
}

function report(
  effective: Record<string, unknown>
): NonNullable<Device["reportedConfig"]> {
  return {
    v: 1,
    deviceId: "dev-1",
    ts: 1_800_000_000_000,
    rev: 3,
    origin: "cloud",
    effective,
    status: {},
  } as unknown as NonNullable<Device["reportedConfig"]>
}

const CAPABLE = {
  agent: { mode: "real", capabilities: ["sms.read", "camera.sensors"] },
}
const OLD = { agent: { mode: "real", capabilities: ["sms.read"] } }

const config = (cameras: unknown) => ({ cameraSensors: { cameras } })

// ---- the builder -----------------------------------------------------------

describe("storedCameraSensors", () => {
  it("is empty for an absent, cleared or malformed namespace", () => {
    for (const c of [
      undefined,
      null,
      {},
      { cameraSensors: null },
      { cameraSensors: { cameras: [] } },
      7,
    ]) {
      expect(storedCameraSensors(c)).toEqual({})
    }
  })

  it("passes entries through as stored, unknown ids and options included", () => {
    const cameras = {
      cam0: { sensor: "imx999", options: { futureOption: 3 } },
      cam1: { sensor: "none" },
      cam2: "not an entry",
      cam3: { options: {} },
    }
    expect(storedCameraSensors(config(cameras))).toEqual({
      cam0: { sensor: "imx999", options: { futureOption: 3 } },
      cam1: { sensor: "none" },
    })
  })
})

describe("buildCameraSensorsConfig", () => {
  const stored = config({
    cam0: { sensor: "imx708", options: { linkFrequency: 447000000 } },
    cam1: { sensor: "imx290", options: { clockFrequency: 74250000 } },
  })

  it("sends the whole namespace and leaves the other port exactly as stored", () => {
    expect(
      buildCameraSensorsConfig(stored, { port: "cam0", sensor: "imx219" })
    ).toEqual({
      cameras: {
        cam0: { sensor: "imx219" },
        cam1: { sensor: "imx290", options: { clockFrequency: 74250000 } },
      },
    })
  })

  it("preserves a sensor id and options this console build does not know", () => {
    // A newer backend catalog: another console (or the API) declared a sensor
    // and an option this build has never heard of. Touching cam0 must not
    // rewrite cam1.
    const newer = config({
      cam0: { sensor: "imx290" },
      cam1: { sensor: "imx999", options: { futureOption: 7, lanes: 4 } },
    })
    const next = buildCameraSensorsConfig(newer, {
      port: "cam0",
      sensor: "none",
    })
    expect(next).toEqual({
      cameras: {
        cam0: { sensor: "none" },
        cam1: { sensor: "imx999", options: { futureOption: 7, lanes: 4 } },
      },
    })
    // The very same object, not a re-typed copy: nothing was normalized away.
    expect(next?.cameras.cam1).toBe(
      (newer.cameraSensors.cameras as Record<string, unknown>).cam1
    )
  })

  it("keeps the touched port's other options, known or not, when one option changes", () => {
    const withUnknown = config({
      cam0: {
        sensor: "imx708",
        options: { linkFrequency: 447000000, futureOption: 9 },
      },
    })
    expect(
      buildCameraSensorsConfig(withUnknown, {
        port: "cam0",
        option: "linkFrequency",
        value: 453000000,
      })
    ).toEqual({
      cameras: {
        cam0: {
          sensor: "imx708",
          options: { linkFrequency: 453000000, futureOption: 9 },
        },
      },
    })
  })

  it("starts a fresh entry when the sensor changes: options belong to their sensor", () => {
    expect(
      buildCameraSensorsConfig(stored, { port: "cam1", sensor: "imx708" })
        ?.cameras.cam1
    ).toEqual({
      sensor: "imx708",
    })
  })

  it("treats re-selecting the stored sensor as no change (its options survive)", () => {
    expect(
      buildCameraSensorsConfig(stored, { port: "cam1", sensor: "imx290" })
    ).toEqual(stored.cameraSensors)
  })

  it("declares an empty port as `none`, without options", () => {
    expect(
      buildCameraSensorsConfig(stored, { port: "cam0", sensor: "none" })
        ?.cameras.cam0
    ).toEqual({
      sensor: "none",
    })
  })

  it("returns a port to 'not managed' by removing its key", () => {
    expect(
      buildCameraSensorsConfig(stored, { port: "cam0", unmanaged: true })
    ).toEqual({
      cameras: {
        cam1: { sensor: "imx290", options: { clockFrequency: 74250000 } },
      },
    })
  })

  it("clears the namespace (null) when no port is left managed", () => {
    const one = config({ cam0: { sensor: "imx708" } })
    expect(
      buildCameraSensorsConfig(one, { port: "cam0", unmanaged: true })
    ).toBeNull()
    expect(
      buildCameraSensorsConfig({}, { port: "cam0", unmanaged: true })
    ).toBeNull()
  })

  it("makes the first declaration on a device that holds no namespace", () => {
    expect(
      buildCameraSensorsConfig({}, { port: "cam1", sensor: "imx219" })
    ).toEqual({
      cameras: { cam1: { sensor: "imx219" } },
    })
  })

  it("ignores an option change on a port with no sensor to set it on", () => {
    expect(
      buildCameraSensorsConfig(
        {},
        { port: "cam0", option: "clockFrequency", value: 74250000 }
      )
    ).toBeNull()
    const empty = config({ cam0: { sensor: "none" } })
    expect(
      buildCameraSensorsConfig(empty, {
        port: "cam0",
        option: "clockFrequency",
        value: 74250000,
      })
    ).toEqual({ cameras: { cam0: { sensor: "none" } } })
  })

  it("drops a port the model no longer declares, which the API would refuse", () => {
    // Left behind by a model reassignment (two-camera model to a one-camera
    // one). The backend answers a save that carries cam1 with a 400.
    expect(
      buildCameraSensorsConfig(
        stored,
        { port: "cam0", sensor: "imx219" },
        { ports: ["cam0"] }
      )
    ).toEqual({ cameras: { cam0: { sensor: "imx219" } } })
    // Unknown ports (no model block): nothing is pruned.
    expect(
      Object.keys(
        buildCameraSensorsConfig(
          stored,
          { port: "cam0", sensor: "imx219" },
          { ports: null }
        )!.cameras
      )
    ).toEqual(["cam0", "cam1"])
  })

  it("never mutates what the device object holds", () => {
    const before = JSON.stringify(stored)
    buildCameraSensorsConfig(stored, {
      port: "cam0",
      option: "linkFrequency",
      value: 450000000,
    })
    buildCameraSensorsConfig(stored, { port: "cam1", unmanaged: true })
    expect(JSON.stringify(stored)).toBe(before)
  })
})

// ---- the gate --------------------------------------------------------------

describe("cameraSensorsGate", () => {
  it("allows a Rust device that has never reported (the choice made at registration)", () => {
    expect(cameraSensorsGate(device())).toEqual({ allowed: true })
  })

  it("allows a Rust device that advertises camera.sensors", () => {
    expect(
      cameraSensorsGate(device({ reportedConfig: report(CAPABLE) }))
    ).toEqual({ allowed: true })
  })

  it("refuses a JS device and names the agent needed", () => {
    const gate = cameraSensorsGate(
      device({ agent: "js", reportedConfig: report(CAPABLE) })
    )
    expect(gate).toMatchObject({ allowed: false, reason: "agent-kind" })
    expect(gate.allowed === false && gate.message).toBe(
      "Choosing a camera sensor needs the Rust agent, version 0.2.0 or newer. This device runs the JS agent."
    )
  })

  it("refuses an agent kind newer than this console", () => {
    const gate = cameraSensorsGate(device({ agent: "zig" as Device["agent"] }))
    expect(gate).toMatchObject({ allowed: false, reason: "agent-kind" })
    expect(gate.allowed === false && gate.message).toContain(
      "This device runs the zig agent."
    )
  })

  it("refuses a simulator, whatever it reports", () => {
    expect(
      cameraSensorsGate(
        device({ simulated: true, reportedConfig: report(CAPABLE) })
      )
    ).toMatchObject({ allowed: false, reason: "simulated" })
    // Fails closed on a row without the flag.
    expect(
      cameraSensorsGate(device({ simulated: undefined as unknown as boolean }))
    ).toMatchObject({ allowed: false, reason: "simulated" })
    expect(cameraSensorsGate(null)).toMatchObject({ allowed: false })
  })

  it("refuses a Rust agent that reported without the capability, naming its build", () => {
    const gate = cameraSensorsGate(
      device({ agentVersion: "v0.1.1", reportedConfig: report(OLD) })
    )
    expect(gate).toMatchObject({ allowed: false, reason: "agent-version" })
    expect(gate.allowed === false && gate.message).toBe(
      "Choosing a camera sensor needs Rust agent 0.2.0 or newer. This device last reported agent " +
        "build v0.1.1; update the agent, then choose a sensor here."
    )
  })

  it("refuses a report with no agent block at all, as the backend does", () => {
    // The backend's gate needs positive evidence once a report exists; a
    // report without a capability list is "stored but hidden" there.
    for (const effective of [
      {},
      { agent: null },
      { agent: { capabilities: "camera.sensors" } },
    ]) {
      const gate = cameraSensorsGate(
        device({ reportedConfig: report(effective) })
      )
      expect(gate).toMatchObject({ allowed: false, reason: "agent-version" })
      expect(gate.allowed === false && gate.message).toContain(
        "has not reported that it supports it"
      )
    }
  })

  it("names the version the catalog gives", () => {
    const catalog = parseCameraCatalog({
      schemaVersion: 1,
      sensors: [
        {
          id: "imx111",
          tier: "supported",
          identity: "none",
          minAgent: "0.4.0",
          overlay: { canFlip: true },
        },
      ],
    })
    const gate = cameraSensorsGate(device({ agent: "js" }), catalog)
    expect(gate.allowed === false && gate.message).toContain(
      "version 0.4.0 or newer"
    )
  })
})

describe("withoutUnheldCameraSensors (the save layer's guard)", () => {
  const cameras = { cameras: { cam0: { sensor: "imx708" } } }

  it("passes a patch through for a device that may hold the namespace", () => {
    const patch = { cameraSensorsConfig: cameras, name: "x" }
    expect(withoutUnheldCameraSensors(device(), patch)).toBe(patch)
    const revert = { cameraSensorsConfig: null }
    expect(
      withoutUnheldCameraSensors(
        device({ reportedConfig: report(CAPABLE) }),
        revert
      )
    ).toBe(revert)
  })

  it.each<[string, Partial<Device>]>([
    ["a JS device", { agent: "js" }],
    ["an older Rust agent", { reportedConfig: report(OLD) }],
    ["a simulator", { simulated: true }],
  ])("drops the key, a null (revert) included, for %s", (_who, overrides) => {
    const d = device(overrides)
    // A revert of everything must not send `cameraSensors: null`: a 400 there
    // would fail the reverts the device does accept.
    expect(
      withoutUnheldCameraSensors(d, {
        cameraSensorsConfig: null,
        cameraMountConfig: null,
        recordingConfig: null,
      })
    ).toEqual({ cameraMountConfig: null, recordingConfig: null })
    expect(
      withoutUnheldCameraSensors(d, { cameraSensorsConfig: cameras })
    ).toEqual({})
  })

  it("never touches a patch that does not carry the key", () => {
    const patch: { recordingConfig: null; cameraSensorsConfig?: unknown } = {
      recordingConfig: null,
    }
    expect(withoutUnheldCameraSensors(device({ agent: "js" }), patch)).toBe(
      patch
    )
  })
})

// ---- ports -----------------------------------------------------------------

const CM5: IoCapabilities = {
  schemaVersion: 2,
  system: { platform: "rpi-cm5" },
  media: {
    video: [
      { key: "cam0", codec: "h264", connector: "csi0", sensor: "imx290" },
      { key: "cam1", codec: "h264", connector: "csi1", sensor: "imx290" },
    ],
  },
}
const CM4: IoCapabilities = {
  schemaVersion: 2,
  system: { platform: "rpi-cm4" },
  media: {
    video: [
      { key: "cam0", codec: "h264", connector: "csi0", sensor: "imx290" },
    ],
  },
}
const LEGACY: IoCapabilities = {
  schemaVersion: 1,
  media: { video: [{ key: "cam0", codec: "h264" }] },
}
const model = (id: string, ioCapabilities: IoCapabilities | null) =>
  ({ id, ioCapabilities }) as Pick<DeviceModel, "id" | "ioCapabilities">

describe("modelCameraPorts", () => {
  it("lists a v2 model's ports with their default sensor, in model order", () => {
    expect(modelCameraPorts(CM5)).toEqual([
      { key: "cam0", connector: "csi0", defaultSensor: "imx290" },
      { key: "cam1", connector: "csi1", defaultSensor: "imx290" },
    ])
  })

  it("is null where the ports are unknown: no model, or no hardware block", () => {
    expect(modelCameraPorts(null)).toBeNull()
    expect(modelCameraPorts(undefined)).toBeNull()
    expect(modelCameraPorts(LEGACY)).toBeNull()
  })

  it("is empty for a v2 model with no cameras", () => {
    expect(
      modelCameraPorts({ schemaVersion: 2, system: { platform: "rpi-cm5" } })
    ).toEqual([])
  })
})

describe("registrationCameraPorts", () => {
  const models = [
    model("cm5", CM5),
    model("cm4", CM4),
    model("old", LEGACY),
    model("bare", null),
  ]

  it("offers the picked model's ports", () => {
    expect(registrationCameraPorts(models, "cm4").map((p) => p.key)).toEqual([
      "cam0",
    ])
    expect(registrationCameraPorts(models, "cm5").map((p) => p.key)).toEqual([
      "cam0",
      "cam1",
    ])
  })

  it("offers nothing for a model without a hardware block, or an unknown pick", () => {
    expect(registrationCameraPorts(models, "old")).toEqual([])
    expect(registrationCameraPorts(models, "gone")).toEqual([])
    expect(registrationCameraPorts(null, "cm5")).toEqual([])
  })

  it("on Automatic offers every model's ports, pre-set where the models agree", () => {
    expect(registrationCameraPorts(models, "auto")).toEqual([
      { key: "cam0", connector: "csi0", defaultSensor: "imx290" },
      { key: "cam1", connector: "csi1", defaultSensor: "imx290" },
    ])
    expect(registrationCameraPorts([], "auto")).toEqual([])
  })

  it("on Automatic pre-sets nothing for a port the models disagree on", () => {
    const other: IoCapabilities = {
      schemaVersion: 2,
      system: { platform: "rpi-cm5" },
      media: {
        video: [
          { key: "cam0", codec: "h264", connector: "csi0", sensor: "imx708" },
        ],
      },
    }
    expect(
      registrationCameraPorts([model("cm5", CM5), model("x", other)], "auto")
    ).toEqual([
      { key: "cam0", connector: null, defaultSensor: null },
      { key: "cam1", connector: "csi1", defaultSensor: "imx290" },
    ])
  })
})

describe("registrationCameras", () => {
  it("reads the choice a Rust registration carries", () => {
    expect(
      registrationCameras({
        code: "c",
        agent: "rust",
        cameras: { cam0: { sensor: "imx708" } },
      })
    ).toEqual({ supported: true, cameras: { cam0: { sensor: "imx708" } } })
    expect(
      registrationCameras({ code: "c", agent: "rust", cameras: null })
    ).toEqual({
      supported: true,
      cameras: {},
    })
  })

  it("says 'not supported' for an answer with no cameras key (an older backend, or JS)", () => {
    expect(registrationCameras({ code: "c", agent: "rust" })).toEqual({
      supported: false,
      cameras: {},
    })
    expect(registrationCameras(null)).toEqual({ supported: false, cameras: {} })
  })
})

describe("nextRegistrationCameras", () => {
  it("sets one port and keeps the rest of the choice as stored", () => {
    const current = {
      cam1: { sensor: "imx290", options: { clockFrequency: 74250000 } },
    }
    expect(nextRegistrationCameras(current, "cam0", "imx708")).toEqual({
      cam0: { sensor: "imx708" },
      cam1: { sensor: "imx290", options: { clockFrequency: 74250000 } },
    })
    // Re-picking the stored sensor keeps its options.
    expect(nextRegistrationCameras(current, "cam1", "imx290")).toEqual(current)
    expect(nextRegistrationCameras(current, "cam1", "none")).toEqual({
      cam1: { sensor: "none" },
    })
    expect(current).toEqual({
      cam1: { sensor: "imx290", options: { clockFrequency: 74250000 } },
    })
  })
})

// ---- the reported truth ----------------------------------------------------

// One block per verdict, as the Rust agent sends them (Phase 0 hand-back, with
// the fix-round wording: the word is `unchecked`, not `unmanaged`).
const OK = {
  connector: "csi0",
  declared: { sensor: "imx708", source: "boot-config" },
  bootConfig: {
    overlay: "imx708",
    line: "dtoverlay=imx708,cam0,rotation=180",
    lines: 1,
  },
  bound: {
    driver: true,
    node: "imx708@1a",
    listed: "imx708",
    path: "/base/soc/i2c0mux/i2c@0/imx708@1a",
    identity: "chip-id",
  },
  capture: { state: "streaming", backoffStep: 0, lastError: null },
  verdict: "ok",
  detail: "imx708 on csi0 is detected and streaming.",
}
const NOT_DETECTED = {
  connector: "csi0",
  declared: { sensor: "imx335", source: "boot-config" },
  bootConfig: { overlay: "imx335", line: "dtoverlay=imx335,cam0", lines: 1 },
  bound: {
    driver: false,
    node: "imx335@1a",
    listed: null,
    path: null,
    identity: "weak",
  },
  capture: { state: "absent", backoffStep: 0, lastError: null },
  verdict: "not-detected",
  detail:
    "csi0 is declared as imx335 by config.txt, but no imx335 answered on this port (the kernel " +
    "driver did not bind). Check the ribbon cable and that the dtoverlay line in config.txt names " +
    "the sensor that is really attached, then reboot.",
}
const EMPTY = {
  connector: "csi1",
  declared: { sensor: "imx290", source: "model" },
  bootConfig: { overlay: null, line: null, lines: 0 },
  bound: {
    driver: false,
    node: null,
    listed: null,
    path: null,
    identity: null,
  },
  capture: { state: "absent", backoffStep: 0, lastError: null },
  verdict: "empty",
  detail:
    "No camera is configured on csi1: config.txt has no camera dtoverlay line for it.",
}
const NO_FRAMES = {
  connector: "csi0",
  declared: { sensor: "imx290", source: "boot-config" },
  bound: {
    driver: true,
    node: "imx290@1a",
    listed: "imx290",
    identity: "none",
  },
  capture: {
    state: "failing",
    backoffStep: 2,
    lastError: "ERROR RPI Camera frontend has timed out!",
  },
  verdict: "no-frames",
  detail:
    "imx290 is listed on csi0 but delivers no frames: its capture process keeps failing.",
}

describe("parseReportedCameras", () => {
  it("is empty when the device reports no camera block", () => {
    for (const rc of [
      null,
      undefined,
      7,
      {},
      report({}),
      report({ cameras: null }),
      report({ cameras: [] }),
    ]) {
      expect(parseReportedCameras(rc)).toEqual([])
    }
  })

  it("reads each port in the device's own order", () => {
    const parsed = parseReportedCameras(
      report({ cameras: { cam0: OK, cam1: EMPTY } })
    )
    expect(parsed).toEqual([
      {
        port: "cam0",
        connector: "csi0",
        declared: { sensor: "imx708", source: "boot-config" },
        detected: "imx708",
        node: "imx708@1a",
        capture: "streaming",
        verdict: "ok",
        detail: "imx708 on csi0 is detected and streaming.",
      },
      {
        port: "cam1",
        connector: "csi1",
        declared: { sensor: "imx290", source: "model" },
        detected: null,
        node: null,
        capture: "absent",
        verdict: "empty",
        detail: EMPTY.detail,
      },
    ])
  })

  it("keeps the device's sentence verbatim", () => {
    const [camera] = parseReportedCameras(
      report({ cameras: { cam0: NOT_DETECTED } })
    )
    expect(camera.detail).toBe(NOT_DETECTED.detail)
  })

  it("keeps a verdict, a state and keys this build has never heard of", () => {
    const [camera] = parseReportedCameras(
      report({
        cameras: {
          cam0: {
            connector: "csi0",
            declared: { sensor: "imx900", source: "eeprom", extra: 1 },
            bound: { listed: "imx900_mono", somethingNew: true },
            capture: { state: "calibrating" },
            verdict: "lens-fogged",
            detail: "The lens looks fogged.",
            newKey: { a: 1 },
          },
        },
      })
    )
    expect(camera).toMatchObject({
      declared: { sensor: "imx900", source: "eeprom" },
      detected: "imx900_mono",
      capture: "calibrating",
      verdict: "lens-fogged",
      detail: "The lens looks fogged.",
    })
  })

  it("survives wrong types everywhere", () => {
    const parsed = parseReportedCameras(
      report({
        cameras: {
          cam0: {
            connector: 7,
            declared: "imx290",
            bound: null,
            capture: [],
            verdict: 42,
            detail: {},
          },
          cam1: "not an object",
          cam2: null,
          cam3: {},
        },
      })
    )
    const blank = {
      connector: null,
      declared: null,
      detected: null,
      node: null,
      capture: null,
      verdict: null,
      detail: null,
    }
    expect(parsed).toEqual([
      { port: "cam0", ...blank },
      { port: "cam3", ...blank },
    ])
  })

  it("bounds a block a misbehaving device could grow", () => {
    const many = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`cam${i}`, OK])
    )
    expect(parseReportedCameras(report({ cameras: many }))).toHaveLength(8)
    const [long] = parseReportedCameras(
      report({ cameras: { cam0: { ...OK, detail: "x".repeat(5000) } } })
    )
    expect(long.detail).toHaveLength(1000)
  })
})

describe("cameraVerdict", () => {
  it.each<[string, string, string]>([
    ["ok", "Working", "ok"],
    ["reboot-required", "Reboot required", "action"],
    ["mismatch", "Mismatch", "problem"],
    ["not-detected", "Not detected", "problem"],
    ["no-frames", "No frames", "problem"],
    ["requirements-missing", "Requirements missing", "problem"],
    ["unknown-sensor", "Unknown sensor", "problem"],
    ["empty", "No camera", "neutral"],
    ["unmanaged", "Not managed", "neutral"],
    ["unchecked", "Not checked", "neutral"],
  ])("%s reads '%s' (%s)", (verdict, label, tone) => {
    expect(cameraVerdict(verdict)).toEqual({ label, tone })
  })

  it("shows a verdict it does not know under its own word, neutrally", () => {
    expect(cameraVerdict("lens-fogged")).toEqual({
      label: "Lens fogged",
      tone: "neutral",
    })
    expect(cameraVerdict("needs_calibration")).toEqual({
      label: "Needs calibration",
      tone: "neutral",
    })
  })

  it("shows nothing for no verdict, and is not fooled by inherited names", () => {
    expect(cameraVerdict(null)).toBeNull()
    expect(cameraVerdict("---")).toBeNull()
    expect(cameraVerdict("constructor")).toEqual({
      label: "Constructor",
      tone: "neutral",
    })
  })
})

describe("reportedCameraFacts", () => {
  const facts = (block: unknown) =>
    reportedCameraFacts(
      parseReportedCameras(report({ cameras: { cam0: block } }))[0]
    )

  it("says what is declared and where from, what was detected, whether frames flow", () => {
    expect(facts(OK)).toEqual({
      declared: "imx708 · config.txt",
      detected: "imx708",
      frames: "Flowing",
    })
    expect(facts(EMPTY)).toEqual({
      declared: "imx290 · device model",
      detected: "None",
      frames: "None",
    })
    expect(facts(NO_FRAMES)).toEqual({
      declared: "imx290 · config.txt",
      detected: "imx290",
      frames: "Failing",
    })
    expect(
      facts({ ...OK, declared: { sensor: "imx708", source: "config" } })
        .declared
    ).toBe("imx708 · this setting")
    expect(
      facts({ ...OK, declared: { sensor: "none", source: "config" } }).declared
    ).toBe("No camera · this setting")
  })

  it("shows words it does not know as sent, and dashes for what is missing", () => {
    expect(
      facts({
        declared: { sensor: "imx900", source: "eeprom" },
        bound: { listed: "imx900_mono" },
        capture: { state: "calibrating" },
      })
    ).toEqual({
      declared: "imx900 · eeprom",
      detected: "imx900_mono",
      frames: "calibrating",
    })
    expect(facts({})).toEqual({ declared: "—", detected: "None", frames: "—" })
    expect(facts({ capture: { state: "toString" } }).frames).toBe("toString")
  })
})

describe("portSensor", () => {
  const reported = parseReportedCameras(
    report({ cameras: { cam0: OK, cam1: EMPTY } })
  )

  it("prefers what the cloud holds, then what the device declares, then what it detected", () => {
    expect(
      portSensor("cam0", config({ cam0: { sensor: "imx335" } }), reported)?.id
    ).toBe("imx335")
    expect(portSensor("cam0", {}, reported)?.id).toBe("imx708")
    const detectedOnly = parseReportedCameras(
      report({ cameras: { cam0: { bound: { listed: "imx219" } } } })
    )
    expect(portSensor("cam0", {}, detectedOnly)?.id).toBe("imx219")
    const nodeOnly = parseReportedCameras(
      report({ cameras: { cam0: { bound: { node: "imx335@1a" } } } })
    )
    expect(portSensor("cam0", {}, nodeOnly)?.id).toBe("imx335")
  })

  it("has no sensor for a port declared empty, or one nobody knows", () => {
    expect(
      portSensor("cam0", config({ cam0: { sensor: "none" } }), reported)
    ).toBeUndefined()
    expect(portSensor("cam2", {}, reported)).toBeUndefined()
    expect(portSensor("cam0", {}, [])).toBeUndefined()
  })

  it("falls back to the device when the stored id is one this build does not know", () => {
    expect(
      portSensor("cam0", config({ cam0: { sensor: "imx999" } }), reported)?.id
    ).toBe("imx708")
  })
})
