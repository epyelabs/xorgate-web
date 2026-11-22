// @vitest-environment jsdom
/**
 * The settings save layer, rendered (jsdom) over a REAL SDK client and a fake
 * fetch, so what is asserted is what goes over the wire.
 *
 * Covers the two things the Camera sensors card leans on
 * (plans/support-other-camera-models, Phase 3 review S2 to S4):
 *
 *  - a `cameraSensors` save is built from a FRESH read of the device, because
 *    the namespace is replaced whole and this form is not its only writer;
 *  - after Reboot Device the hook re-reads a device that says it waits for a
 *    reboot, on a bounded schedule, until it no longer says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, createElement, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createClient } from "@xorgate/sdk"

type Call = { method: string; path: string; body: unknown }
const calls: Call[] = []
/** The device row as the "cloud" holds it; tests mutate it to play other writers. */
let server: Record<string, unknown>
/** Optional gate on the next GET, to hold a save mid-flight. */
let holdGet: Promise<void> | null = null
let patchStatus = 200

const fakeFetch = vi.fn(async (input: string, init?: RequestInit) => {
  const url = new URL(input)
  const method = init?.method ?? "GET"
  const body =
    typeof init?.body === "string" ? JSON.parse(init.body) : undefined
  calls.push({ method, path: url.pathname, body })
  const json = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    })
  if (method === "GET" && url.pathname === "/v1/devices/dev-1") {
    if (holdGet) await holdGet
    return json(200, { device: structuredClone(server) })
  }
  if (method === "PATCH" && url.pathname === "/v1/devices/dev-1/config") {
    if (patchStatus !== 200) {
      return json(patchStatus, {
        error: { code: "BAD_REQUEST", message: "refused by the API" },
      })
    }
    const config = { ...(server.config as Record<string, unknown>) }
    for (const [ns, value] of Object.entries(body as Record<string, unknown>)) {
      if (value === null) delete config[ns]
      else config[ns] = value
    }
    server = { ...server, config, configRev: (server.configRev as number) + 1 }
    return json(200, { device: structuredClone(server) })
  }
  return json(404, { message: "Not Found" })
})

const client = createClient({
  baseUrl: "https://api.example",
  auth: { getToken: async () => "t" },
  organizationId: "org-1",
  workspaceId: "ws-1",
  fetch: fakeFetch,
})
vi.mock("@/lib/xorgate", () => ({
  xg: () => client,
  xgMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))
vi.mock("@/queries/tenant", () => ({
  useTenant: () => ({ orgId: "org-1", wsId: "ws-1", ready: true }),
}))
const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError, info: vi.fn() },
}))

const { useDeviceSettings } = await import("./use-device-settings")
const { CAMERA_SENSORS_SAVE_KEY } = await import("@/lib/device-cameras")
const { useDeviceRebootStore } = await import("@/store/device-reboot")
type Settings = ReturnType<typeof useDeviceSettings>

const CAPABLE = { mode: "real", capabilities: ["sms.read", "camera.sensors"] }
const REBOOT_DETAIL =
  "written to the boot config — REBOOT REQUIRED to apply: cam1 imx290"
const report = (overrides: Record<string, unknown> = {}) => ({
  v: 1,
  deviceId: "dev-1",
  ts: 1_800_000_000_000,
  rev: 5,
  origin: "cloud",
  effective: { agent: CAPABLE },
  status: {},
  ...overrides,
})
const baseDevice = () => ({
  id: "dev-1",
  workspaceId: "ws-1",
  deviceModelId: "m1",
  serial: "s1",
  name: "bench",
  agent: "rust",
  agentVersion: "v0.2.0",
  status: "online",
  simulated: false,
  config: {
    cameraSensors: {
      cameras: { cam0: { sensor: "imx708" }, cam1: { sensor: "imx290" } },
    },
  },
  configRev: 5,
  uiPrefs: {},
  reportedConfig: report(),
  reportedAt: "2026-11-21T00:00:00Z",
})

let container: HTMLDivElement
let root: Root
let settings: Settings
/** Hands every render's hook value to the test, from an effect. */
function Probe({ onRender }: { onRender: (value: Settings) => void }) {
  const value = useDeviceSettings("dev-1")
  useEffect(() => {
    onRender(value)
  })
  return null
}
function mount() {
  const queryClient = new QueryClient()
  act(() => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Probe, {
          onRender: (value) => {
            settings = value
          },
        })
      )
    )
  })
}
/** Let every pending request and effect run (real timers). */
async function settle() {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}
const writes = () => calls.filter((c) => c.method !== "GET")
const reads = () => calls.filter((c) => c.method === "GET")

beforeEach(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0
  fakeFetch.mockClear()
  toastSuccess.mockClear()
  toastError.mockClear()
  server = baseDevice()
  holdGet = null
  patchStatus = 200
  useDeviceRebootStore.setState({ requestedAt: {} })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe("commitCameraSensors: built from a fresh read", () => {
  it("keeps what another writer did to the other port", async () => {
    mount()
    await settle()
    calls.length = 0
    // Meanwhile, on the device: `xorgate-rs set cameraSensors.cam1.sensor none`
    // folded back into the cloud document. This form still shows imx290.
    server = {
      ...server,
      config: {
        cameraSensors: {
          cameras: { cam0: { sensor: "imx708" }, cam1: { sensor: "none" } },
        },
      },
      configRev: 6,
    }
    expect(settings.device!.config.cameraSensors).toEqual({
      cameras: { cam0: { sensor: "imx708" }, cam1: { sensor: "imx290" } },
    })

    act(() =>
      settings.commitCameraSensors({ port: "cam0", sensor: "imx219" }, [
        "cam0",
        "cam1",
      ])
    )
    await settle()

    // One fresh read, then ONE write carrying the device's own cam1.
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /v1/devices/dev-1",
      "PATCH /v1/devices/dev-1/config",
    ])
    expect(writes()[0].body).toEqual({
      cameraSensors: {
        cameras: { cam0: { sensor: "imx219" }, cam1: { sensor: "none" } },
      },
    })
    // The form now shows what the cloud holds, the other writer's port included.
    expect(settings.device!.config.cameraSensors).toEqual({
      cameras: { cam0: { sensor: "imx219" }, cam1: { sensor: "none" } },
    })
    expect(toastSuccess).toHaveBeenCalledWith("Settings saved")
  })

  it("keeps another writer's option on the port it does not touch", async () => {
    mount()
    await settle()
    server = {
      ...server,
      config: {
        cameraSensors: {
          cameras: {
            cam0: { sensor: "imx708" },
            cam1: { sensor: "imx290", options: { clockFrequency: 74250000 } },
          },
        },
      },
    }
    calls.length = 0
    act(() =>
      settings.commitCameraSensors(
        { port: "cam0", option: "linkFrequency", value: 447000000 },
        null
      )
    )
    await settle()
    expect(writes()[0].body).toEqual({
      cameraSensors: {
        cameras: {
          cam0: { sensor: "imx708", options: { linkFrequency: 447000000 } },
          cam1: { sensor: "imx290", options: { clockFrequency: 74250000 } },
        },
      },
    })
  })

  it("sends nothing when the fresh row already holds what was asked for", async () => {
    mount()
    await settle()
    // Another tab made the very same change first.
    server = {
      ...server,
      config: {
        cameraSensors: {
          cameras: { cam0: { sensor: "imx219" }, cam1: { sensor: "imx290" } },
        },
      },
      configRev: 6,
    }
    calls.length = 0
    act(() =>
      settings.commitCameraSensors({ port: "cam0", sensor: "imx219" }, null)
    )
    await settle()
    expect(writes()).toEqual([])
    expect(reads()).toHaveLength(1)
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(settings.device!.configRev).toBe(6)
  })

  it("sends nothing when the fresh row shows a device that no longer qualifies", async () => {
    mount()
    await settle()
    // The agent was downgraded: the report no longer carries the capability,
    // and the backend withdrew the value. A write would be a 400.
    server = {
      ...server,
      config: {},
      configRev: 6,
      reportedConfig: report({
        effective: { agent: { mode: "real", capabilities: ["sms.read"] } },
      }),
    }
    calls.length = 0
    act(() =>
      settings.commitCameraSensors({ port: "cam0", sensor: "imx219" }, null)
    )
    await settle()
    expect(writes()).toEqual([])
    expect(toastError).not.toHaveBeenCalled()
    // The form is re-seeded from the fresh row: nothing stored, the new report.
    expect(settings.device!.config.cameraSensors).toBeUndefined()
    expect(settings.configStatus.cameraSensors.state).toBe("unset")
  })

  it("clears a leftover value with null, from a fresh read too", async () => {
    mount()
    await settle()
    calls.length = 0
    act(() => settings.commitCameraSensors({ clear: true }, null))
    await settle()
    expect(calls.map((c) => c.method)).toEqual(["GET", "PATCH"])
    expect(writes()[0].body).toEqual({ cameraSensors: null })
  })

  it("is pending under ONE key for the whole card while the save is in flight", async () => {
    mount()
    await settle()
    let release!: () => void
    holdGet = new Promise<void>((r) => (release = r))
    act(() =>
      settings.commitCameraSensors({ port: "cam0", sensor: "imx219" }, null)
    )
    await settle()
    expect(settings.isPending(CAMERA_SENSORS_SAVE_KEY)).toBe(true)
    expect(writes()).toEqual([])
    holdGet = null
    release()
    await settle()
    expect(settings.isPending(CAMERA_SENSORS_SAVE_KEY)).toBe(false)
    expect(writes()).toHaveLength(1)
  })

  it("rolls the form back to the FRESH row when the API refuses the save", async () => {
    mount()
    await settle()
    server = {
      ...server,
      config: {
        cameraSensors: {
          cameras: { cam0: { sensor: "imx708" }, cam1: { sensor: "none" } },
        },
      },
    }
    patchStatus = 400
    act(() =>
      settings.commitCameraSensors({ port: "cam0", sensor: "imx219" }, null)
    )
    await settle()
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(settings.device!.config.cameraSensors).toEqual({
      cameras: { cam0: { sensor: "imx708" }, cam1: { sensor: "none" } },
    })
  })

  it("leaves every other save as it was: no extra read, its namespace only", async () => {
    mount()
    await settle()
    calls.length = 0
    act(() =>
      settings.commit("device-camera-mount-cam0", {
        cameraMountConfig: { cameras: { cam0: { rotationDeg: 180 } } },
      })
    )
    await settle()
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "PATCH /v1/devices/dev-1/config",
    ])
    expect(writes()[0].body).toEqual({
      cameraMount: { cameras: { cam0: { rotationDeg: 180 } } },
    })
  })
})

describe("after Reboot Device: the page re-reads a device that waits for a reboot", () => {
  const WAITING = report({
    effective: {
      agent: CAPABLE,
      cameras: {
        cam1: { verdict: "reboot-required", detail: "Reboot to apply." },
      },
    },
    status: {
      cameraSensors: { state: "adjusted", at: 1, detail: REBOOT_DETAIL },
    },
  })
  const BACK = report({
    effective: {
      agent: CAPABLE,
      cameras: {
        cam1: {
          verdict: "ok",
          detail: "imx290 on csi1 is detected and streaming.",
        },
      },
    },
    status: { cameraSensors: { state: "applied", at: 2 } },
  })
  const fakeTimers = () =>
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
      ],
    })
  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

  it("does not poll a waiting device until a reboot was asked for", async () => {
    fakeTimers()
    server = { ...server, reportedConfig: WAITING }
    mount()
    await advance(50)
    expect(settings.configStatus.cameraSensors.state).toBe("adjusted")
    calls.length = 0
    await advance(60_000)
    expect(reads()).toEqual([])
  })

  it("re-reads every 5 s once Reboot Device was asked, and stops when the device came back", async () => {
    fakeTimers()
    server = { ...server, reportedConfig: WAITING }
    mount()
    await advance(50)
    calls.length = 0
    act(() => useDeviceRebootStore.getState().markRequested("dev-1"))
    await advance(15_000)
    expect(reads()).toHaveLength(3)
    expect(settings.configStatus.cameraSensors.state).toBe("adjusted")

    // The device rebooted and reported: detected and streaming.
    server = { ...server, reportedConfig: BACK }
    await advance(5_000)
    expect(reads()).toHaveLength(4)
    expect(settings.configStatus.cameraSensors.state).toBe("applied")
    // …and the page shows it without a reload, then leaves the device alone.
    calls.length = 0
    await advance(120_000)
    expect(reads()).toEqual([])
  })

  it("gives up after three minutes on a device that never comes back", async () => {
    fakeTimers()
    server = { ...server, reportedConfig: WAITING }
    mount()
    await advance(50)
    calls.length = 0
    act(() => useDeviceRebootStore.getState().markRequested("dev-1"))
    await advance(10 * 60_000)
    // 5 s steps inside a 3 minute window, the deadline tick excluded.
    expect(reads()).toHaveLength(35)
  })

  it("covers a rotation written to the boot config the same way", async () => {
    fakeTimers()
    server = {
      ...server,
      config: { cameraMount: { cameras: { cam0: { rotationDeg: 180 } } } },
      reportedConfig: report({
        status: {
          cameraMount: {
            state: "adjusted",
            at: 1,
            detail:
              "written to the boot config — REBOOT REQUIRED to apply: cam0 180° (running 0°)",
          },
        },
      }),
    }
    mount()
    await advance(50)
    calls.length = 0
    act(() => useDeviceRebootStore.getState().markRequested("dev-1"))
    await advance(10_000)
    expect(reads()).toHaveLength(2)
    server = {
      ...server,
      reportedConfig: report({ status: { cameraMount: { state: "applied" } } }),
    }
    await advance(5_000)
    expect(settings.configStatus.cameraMount.state).toBe("applied")
    calls.length = 0
    await advance(60_000)
    expect(reads()).toEqual([])
  })

  it("ignores a reboot asked of another device", async () => {
    fakeTimers()
    server = { ...server, reportedConfig: WAITING }
    mount()
    await advance(50)
    calls.length = 0
    act(() => useDeviceRebootStore.getState().markRequested("dev-2"))
    await advance(30_000)
    expect(reads()).toEqual([])
  })
})
