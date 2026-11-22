// @vitest-environment jsdom
/**
 * The Camera sensors card, rendered (jsdom). The rules it draws from are
 * tested DOM-free in `lib/device-cameras.test.ts`; this pins what an operator
 * actually gets on screen: who sees the card at all, that each thing is said
 * once, that a real status is never hidden, and that one save disables every
 * control (plans/support-other-camera-models, Phase 3 review).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { Device } from "@xorgate/sdk"
import { CAMERA_SENSORS_SAVE_KEY, type CameraPort } from "@/lib/device-cameras"
import type { NamespaceStatus } from "@/lib/device-config-status"
import { CameraSensorsCard } from "./camera-sensors-card"

const PORTS: CameraPort[] = [
  { key: "cam0", connector: "csi0", defaultSensor: "imx290" },
  { key: "cam1", connector: "csi1", defaultSensor: "imx290" },
]
const CAPABLE = { mode: "real", capabilities: ["camera.sensors"] }
const REBOOT_DETAIL =
  "written to the boot config — REBOOT REQUIRED to apply: cam1 imx290"

function report(effective: Record<string, unknown>) {
  return {
    v: 1,
    deviceId: "dev-1",
    ts: 1,
    rev: 5,
    origin: "cloud",
    effective,
    status: {},
  } as unknown as NonNullable<Device["reportedConfig"]>
}

function device(overrides: Record<string, unknown> = {}): Device {
  return {
    id: "dev-1",
    agent: "rust",
    agentVersion: "v0.2.0",
    simulated: false,
    status: "online",
    config: {},
    configRev: 5,
    reportedConfig: report({ agent: CAPABLE }),
    ...overrides,
  } as unknown as Device
}

const cameras = (blocks: Record<string, unknown>) =>
  report({ agent: CAPABLE, cameras: blocks })
const sensors = (map: Record<string, unknown>) => ({
  cameraSensors: { cameras: map },
})

let container: HTMLDivElement
let root: Root
const commitCameraSensors = vi.fn()

function render(props: {
  device: Device
  ports?: CameraPort[] | null
  modelState?: "loading" | "ready" | "error"
  status?: NamespaceStatus
  saving?: boolean
}) {
  act(() => {
    root.render(
      createElement(CameraSensorsCard, {
        device: props.device,
        ports: props.ports === undefined ? PORTS : props.ports,
        modelState: props.modelState ?? "ready",
        status: props.status ?? { state: "unset" },
        isPending: (key: string) =>
          props.saving === true && key === CAMERA_SENSORS_SAVE_KEY,
        commitCameraSensors,
      })
    )
  })
}

const card = () =>
  container.querySelector<HTMLElement>('[data-testid="camera-sensors-card"]')
const $ = (testid: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${testid}"]`)
const selects = () => [
  ...container.querySelectorAll<HTMLButtonElement>('button[role="combobox"]'),
]
const text = () => card()?.textContent ?? ""

beforeEach(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  commitCameraSensors.mockClear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("who sees the card", () => {
  it("is not rendered for a JS device: nothing to choose, nothing reported", () => {
    render({ device: device({ agent: "js" }) })
    expect(card()).toBeNull()
    expect(container.textContent).toBe("")
  })

  it("is not rendered for a simulator", () => {
    render({ device: device({ simulated: true }) })
    expect(card()).toBeNull()
  })

  it("is not rendered for a capable device whose model has no cameras and nothing to say", () => {
    render({ device: device(), ports: [] })
    expect(card()).toBeNull()
    render({ device: device(), ports: null })
    expect(card()).toBeNull()
  })

  it("keeps the card for an older Rust agent: the truth it reports and one version line", () => {
    render({
      device: device({
        agentVersion: "v0.1.1",
        reportedConfig: report({
          agent: { mode: "real", capabilities: ["sms.read"] },
          cameras: {
            cam0: {
              connector: "csi0",
              declared: { sensor: "imx290", source: "boot-config" },
              bound: { listed: "imx290" },
              capture: { state: "streaming" },
              verdict: "ok",
              detail: "imx290 on csi0 is detected and streaming.",
            },
          },
        }),
      }),
    })
    expect(selects()).toHaveLength(0)
    expect($("camera-verdict-cam0")?.textContent).toBe("Working")
    expect($("camera-sensors-gate")?.textContent).toBe(
      "Choosing a camera sensor needs Rust agent 0.2.0 or newer. This device last reported " +
        "agent build v0.1.1; update the agent, then choose a sensor here."
    )
    // No badge: the namespace does not exist for this device.
    expect(text()).not.toMatch(/Synced|Applying|Adjusted|Rejected/)
  })

  it("offers one sensor select per model port to a capable device", () => {
    render({
      device: device({ config: sensors({ cam0: { sensor: "imx219" } }) }),
    })
    expect(selects()).toHaveLength(2)
    expect(selects()[0].textContent).toContain("Sony IMX219")
    expect(selects()[1].textContent).toContain("Not managed")
  })
})

describe("each thing is said once", () => {
  it("describes itself in one short sentence that does not talk about rebooting", () => {
    render({ device: device() })
    expect(text()).toContain(
      "Which image sensor is attached to each camera port."
    )
    expect(text()).not.toMatch(/boot/i)
  })

  it("says a healthy port once: the detected sensor and the indicator, no sentence, no facts", () => {
    render({
      device: device({
        config: sensors({ cam0: { sensor: "imx708" } }),
        reportedConfig: cameras({
          cam0: {
            declared: { sensor: "imx708", source: "config" },
            bound: { listed: "imx708_wide" },
            capture: { state: "streaming" },
            verdict: "ok",
            detail: "imx708 on csi0 is detected and streaming.",
          },
        }),
      }),
    })
    expect($("camera-verdict-cam0")?.textContent).toBe("Working")
    expect($("camera-detected-cam0")?.textContent).toBe("imx708_wide")
    expect($("camera-detail-cam0")).toBeNull()
    expect($("camera-facts-cam0")).toBeNull()
    expect(text()).not.toContain("detected and streaming")
  })

  it("says a deliberately empty port once: the indicator alone", () => {
    render({
      device: device({
        config: sensors({ cam1: { sensor: "none" } }),
        reportedConfig: cameras({
          cam1: {
            declared: { sensor: "none", source: "config" },
            capture: { state: "absent" },
            verdict: "empty",
            detail:
              "csi1 is declared empty by the camera sensor setting: no camera is configured on it.",
          },
        }),
      }),
    })
    expect($("camera-verdict-cam1")?.textContent).toBe("No camera")
    expect($("camera-detail-cam1")).toBeNull()
    expect($("camera-facts-cam1")).toBeNull()
    expect($("camera-detected-cam1")).toBeNull()
  })

  const NOT_DETECTED = {
    declared: { sensor: "imx219", source: "config" },
    bound: { listed: null },
    capture: { state: "absent" },
    verdict: "not-detected",
    detail:
      "csi0 is set to imx219, but no imx219 answered on this port (the kernel driver did not bind). Check the ribbon cable and the selected sensor.",
  }

  it("gives a port in trouble the device's sentence and the facts, without repeating the select", () => {
    render({
      device: device({
        config: sensors({ cam0: { sensor: "imx219" } }),
        reportedConfig: cameras({ cam0: NOT_DETECTED }),
      }),
    })
    expect($("camera-detail-cam0")?.textContent).toBe(NOT_DETECTED.detail)
    const facts = $("camera-facts-cam0")?.textContent ?? ""
    expect(facts).toContain("Detected")
    expect(facts).toContain("Frames")
    // The select above already says what is declared.
    expect(facts).not.toContain("Declared")
  })

  it("keeps 'Declared' on an unmanaged port, the only place config.txt's sensor shows", () => {
    render({
      device: device({
        reportedConfig: cameras({
          cam0: {
            ...NOT_DETECTED,
            declared: { sensor: "imx219", source: "boot-config" },
          },
        }),
      }),
    })
    expect(selects()[0].textContent).toContain("Not managed")
    expect($("camera-facts-cam0")?.textContent).toContain(
      "Declaredimx219 · config.txt"
    )
  })

  const REBOOT_SENTENCE =
    "The camera line of csi1 in config.txt was added since this device booted (the file now says `dtoverlay=imx290,cam1,rotation=0`). Reboot to apply."
  const WAITING = device({
    config: sensors({ cam1: { sensor: "imx290" } }),
    reportedConfig: cameras({
      cam1: {
        declared: { sensor: "imx290", source: "config" },
        capture: { state: "absent" },
        verdict: "reboot-required",
        detail: REBOOT_SENTENCE,
      },
    }),
  })

  it("says a pending reboot once per port: the indicator and the device's sentence", () => {
    render({
      device: WAITING,
      status: { state: "adjusted", detail: REBOOT_DETAIL },
    })
    expect($("camera-verdict-cam1")?.textContent).toBe("Reboot required")
    expect($("camera-detail-cam1")?.textContent).toBe(REBOOT_SENTENCE)
    // No facts under it: they would read "None / None".
    expect($("camera-facts-cam1")).toBeNull()
    // No console line of its own, and no callout repeating the reboot.
    expect(text()).not.toContain("Use Reboot Device")
    expect(text()).not.toContain("REBOOT REQUIRED")
    expect(text().split("Reboot to apply.").length - 1).toBe(1)
  })

  it("shows a sentence once when the callout would carry the port's own words", () => {
    const sentence =
      'this agent build does not know the camera sensor "imx335" (it knows: imx290, imx219, imx708); update the agent or choose another sensor. config.txt is left as it is'
    render({
      device: device({
        config: sensors({ cam0: { sensor: "imx335" } }),
        reportedConfig: cameras({
          cam0: { verdict: "unknown-sensor", detail: sentence },
        }),
      }),
      status: { state: "rejected", reason: `cam0: ${sentence}` },
    })
    expect(text()).toContain("Rejected")
    expect(text().split("this agent build does not know").length - 1).toBe(1)
  })

  it("keeps the callout when it says something the ports do not", () => {
    render({
      device: WAITING,
      status: {
        state: "rejected",
        reason:
          "cam0: could not edit /boot/firmware/config.txt: no overlay file",
      },
    })
    expect(text()).toContain("could not edit /boot/firmware/config.txt")
    expect($("camera-detail-cam1")?.textContent).toBe(REBOOT_SENTENCE)
  })

  it("does not put 'cannot be rotated' under the sensor select", () => {
    render({
      device: device({ config: sensors({ cam0: { sensor: "imx335" } }) }),
    })
    expect(selects()[0].textContent).toContain("Sony IMX335")
    expect(text()).not.toMatch(/cannot be rotated|extra packages/)
  })
})

describe("one save disables the whole card", () => {
  it("disables every select, the options included, while a save is in flight", () => {
    const d = device({
      config: sensors({
        cam0: { sensor: "imx708" },
        cam1: { sensor: "imx290" },
      }),
    })
    render({ device: d })
    // Two sensor selects and one option select each.
    expect(selects()).toHaveLength(4)
    expect(selects().every((s) => !s.disabled)).toBe(true)
    render({ device: d, saving: true })
    expect(selects()).toHaveLength(4)
    expect(selects().every((s) => s.disabled)).toBe(true)
  })
})

describe("a real status is never hidden", () => {
  const REASON =
    'cam1: this device has no camera "cam1"; config.txt is left as it is'
  const LEFTOVER = device({
    config: sensors({ cam0: { sensor: "imx708" }, cam1: { sensor: "imx219" } }),
  })

  it("shows the badge and the device's reason on a model without camera ports", () => {
    render({
      device: LEFTOVER,
      ports: null,
      status: { state: "rejected", reason: REASON },
    })
    expect(selects()).toHaveLength(0)
    expect(text()).toContain("Rejected")
    expect(text()).toContain(REASON)
  })

  it("offers one action for a value left behind there: clear it", () => {
    render({
      device: LEFTOVER,
      ports: null,
      status: { state: "rejected", reason: REASON },
    })
    expect($("camera-sensors-gate")?.textContent).toBe(
      "This device’s model declares no camera ports, but a camera sensor setting is still stored for it."
    )
    const clear = $("camera-sensors-clear") as HTMLButtonElement
    expect(clear.textContent).toBe("Clear the setting")
    act(() => clear.click())
    expect(commitCameraSensors).toHaveBeenCalledTimes(1)
    expect(commitCameraSensors).toHaveBeenCalledWith({ clear: true }, null)
  })

  it("offers the same on a v2 model that declares zero cameras", () => {
    render({ device: LEFTOVER, ports: [] })
    expect($("camera-sensors-clear")).not.toBeNull()
  })

  it("disables the clear action while it is being saved", () => {
    render({ device: LEFTOVER, ports: null, saving: true })
    expect(($("camera-sensors-clear") as HTMLButtonElement).disabled).toBe(true)
  })

  it("offers no clear action when nothing is stored, or when the model merely failed to load", () => {
    render({
      device: device({ reportedConfig: cameras({ cam0: { verdict: "ok" } }) }),
      ports: null,
    })
    expect($("camera-sensors-clear")).toBeNull()
    expect($("camera-sensors-gate")?.textContent).toContain(
      "declares no camera ports, so a sensor cannot be chosen per port."
    )
    // A failed model query is not "no ports": clearing would be a guess.
    render({
      device: LEFTOVER,
      ports: null,
      modelState: "error",
      status: { state: "rejected", reason: REASON },
    })
    expect($("camera-sensors-clear")).toBeNull()
    expect($("camera-sensors-gate")?.textContent).toContain(
      "could not be loaded"
    )
    // …and the status is still there.
    expect(text()).toContain("Rejected")
    expect(text()).toContain(REASON)
  })
})
