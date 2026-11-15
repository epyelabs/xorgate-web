import { beforeEach, describe, expect, it, vi } from "vitest"
import { XorgateError, type AgentBuild, type DeviceModel } from "@xorgate/sdk"

// The raw-request seam: every network helper goes through xg().request().
const request = vi.fn()
let workspaceId: string | undefined = "ws-1"
vi.mock("@/lib/xorgate", () => ({ xg: () => ({ request, workspaceId }) }))

const {
  agentOrJs,
  agentUpdateState,
  channelFromBody,
  createRegistration,
  fetchAgentChannel,
  fetchDeviceAgent,
  fetchFleetAgents,
  getRegistration,
  isAgentKind,
  isAgentNotEnabled,
  isCm4Model,
  registrationBody,
  registrationMatchesPick,
  rustOption,
  updaterUnit,
  RUST_REASON_FLAG_OFF,
  RUST_REASON_NO_RELEASE,
  RUST_REASON_CHECK_FAILED,
  RUST_REASON_OLD_API,
  UNSUPPORTED_CHANNEL,
} = await import("./agent-channel")

const BUILD_RS: AgentBuild = {
  version: "14413e0",
  channel: "dev",
  builtAt: "2026-11-14T18:22:22Z",
  packageVersion: "0.0.1",
  tarball: "xorgate-agent-rs-14413e0.tar.gz",
} as AgentBuild
const BUILD_JS: AgentBuild = {
  version: "09da38d",
  channel: "dev",
  builtAt: "2026-10-18T15:49:01Z",
  packageVersion: "0.2.0",
  tarball: "xorgate-agent-09da38d.tar.gz",
} as AgentBuild

const REG_OLD = {
  code: "ABCD1234",
  status: "pending",
  deviceId: null,
  expiresAt: "2026-11-14T20:00:00Z",
  installUrl: "https://api.example/get/ABCD1234",
}

beforeEach(() => {
  request.mockReset()
  workspaceId = "ws-1"
})

describe("agent kinds", () => {
  it("narrows only js and rust", () => {
    expect(isAgentKind("js")).toBe(true)
    expect(isAgentKind("rust")).toBe(true)
    expect(isAgentKind("go")).toBe(false)
    expect(isAgentKind(undefined)).toBe(false)
    expect(isAgentKind(null)).toBe(false)
  })

  it("reads a missing agent as js (old backend) and passes unknown values through", () => {
    expect(agentOrJs(undefined)).toBe("js")
    expect(agentOrJs(null)).toBe("js")
    expect(agentOrJs("")).toBe("js")
    expect(agentOrJs("rust")).toBe("rust")
    expect(agentOrJs("go")).toBe("go")
  })

  it("names the updater unit per agent", () => {
    expect(updaterUnit("js")).toBe("xorgate-updater")
    expect(updaterUnit("rust")).toBe("xorgate-updater-rs")
    expect(updaterUnit(null)).toBe("xorgate-updater")
    expect(updaterUnit(undefined)).toBe("xorgate-updater")
  })
})

describe("registrations", () => {
  it("sends no body for a plain JS registration, exactly as before Phase 8", () => {
    expect(registrationBody({ agent: "js" })).toBeUndefined()
    expect(registrationBody({ agent: "js", deviceModelId: "m1" })).toEqual({
      deviceModelId: "m1",
    })
    expect(registrationBody({ agent: "rust" })).toEqual({ agent: "rust" })
    expect(registrationBody({ agent: "rust", deviceModelId: "m1" })).toEqual({
      agent: "rust",
      deviceModelId: "m1",
    })
  })

  it("POSTs through the raw request with the right body", async () => {
    request.mockResolvedValueOnce({ ...REG_OLD, agent: "rust" })
    const r = await createRegistration({ agent: "rust", deviceModelId: "m1" })
    expect(request).toHaveBeenCalledWith("POST", "/device-registrations", {
      body: { agent: "rust", deviceModelId: "m1" },
    })
    expect(r.agent).toBe("rust")

    request.mockResolvedValueOnce(REG_OLD)
    await createRegistration({ agent: "js" })
    expect(request).toHaveBeenLastCalledWith(
      "POST",
      "/device-registrations",
      {}
    )
  })

  it("N3: refuses locally without a workspace, sending nothing", async () => {
    workspaceId = undefined
    await expect(createRegistration({ agent: "js" })).rejects.toMatchObject({
      code: "INVALID_CONFIG",
    })
    expect(request).not.toHaveBeenCalled()
  })

  it("fills agent=js when the backend omits it (create and get)", async () => {
    request.mockResolvedValueOnce(REG_OLD)
    expect((await createRegistration({ agent: "js" })).agent).toBe("js")
    request.mockResolvedValueOnce(REG_OLD)
    expect((await getRegistration("ABCD1234")).agent).toBe("js")
    expect(request).toHaveBeenLastCalledWith(
      "GET",
      "/device-registrations/ABCD1234"
    )
  })

  it("M1 echo guard: old backend + JS pick shows the command; Rust pick does not", () => {
    // The raw row an old backend returns has no `agent` at all.
    expect(registrationMatchesPick(REG_OLD as { agent?: string }, "js")).toBe(
      true
    )
    expect(registrationMatchesPick(REG_OLD as { agent?: string }, "rust")).toBe(
      false
    )
    expect(registrationMatchesPick({ agent: "rust" }, "rust")).toBe(true)
    expect(registrationMatchesPick({ agent: "rust" }, "js")).toBe(false)
    expect(registrationMatchesPick({ agent: "js" }, "rust")).toBe(false)
    expect(registrationMatchesPick({ agent: "go" }, "rust")).toBe(false)
    expect(registrationMatchesPick({ agent: "go" }, "js")).toBe(false)
    expect(registrationMatchesPick(null, "js")).toBe(false)
  })

  it("recognises AGENT_NOT_ENABLED", () => {
    const e = new XorgateError({
      code: "AGENT_NOT_ENABLED" as never,
      message: "no",
      status: 409,
    })
    expect(isAgentNotEnabled(e)).toBe(true)
    expect(
      isAgentNotEnabled(
        new XorgateError({ code: "CONFLICT", message: "x", status: 409 })
      )
    ).toBe(false)
    expect(isAgentNotEnabled(new Error("AGENT_NOT_ENABLED"))).toBe(false)
  })
})

describe("the agent channel", () => {
  it("reads a self-describing answer", () => {
    expect(
      channelFromBody(
        { agent: "rust", latest: BUILD_RS, registrationEnabled: true },
        "rust"
      )
    ).toEqual({ agent: "rust", latest: BUILD_RS, registrationEnabled: true })
    expect(
      channelFromBody(
        { agent: "rust", latest: null, registrationEnabled: false },
        "rust"
      )
    ).toEqual({ agent: "rust", latest: null, registrationEnabled: false })
  })

  it("S1: an un-echoed body (old backend) is NEVER the Rust channel", () => {
    expect(channelFromBody({ latest: BUILD_JS }, "rust")).toEqual(
      UNSUPPORTED_CHANNEL
    )
    expect(channelFromBody(null, "rust")).toEqual(UNSUPPORTED_CHANNEL)
    expect(channelFromBody([], "rust")).toEqual(UNSUPPORTED_CHANNEL)
    expect(channelFromBody({ agent: "" }, "rust")).toEqual(UNSUPPORTED_CHANNEL)
  })

  it("S1: an un-echoed body (old backend) IS the JS manifest when JS was asked", () => {
    expect(channelFromBody({ latest: BUILD_JS }, "js")).toEqual({
      agent: "js",
      latest: BUILD_JS,
      registrationEnabled: true,
    })
    // No manifest field at all: nothing to compare against.
    expect(channelFromBody({}, "js")).toEqual({
      agent: "js",
      latest: null,
      registrationEnabled: true,
    })
    // An echo always wins over the fallback.
    expect(
      channelFromBody(
        { agent: "js", latest: null, registrationEnabled: true },
        "js"
      ).latest
    ).toBeNull()
  })

  it("S1: a JS device on an old backend keeps today's update check and target version", async () => {
    // Old backend: ignores ?agent= and answers today's { latest } shape.
    request.mockResolvedValue({ latest: BUILD_JS })
    const jsChannel = await fetchAgentChannel("js")
    const rustChannel = await fetchAgentChannel("rust")
    expect(
      agentUpdateState({
        deviceAgent: "js",
        channel: jsChannel,
        installedVersion: "aaaaaaa",
      })
    ).toEqual({ kind: "update-available", latest: BUILD_JS })
    // Same version installed: up to date, so the dialog offers a reinstall of
    // BUILD_JS and passes it as expectedVersion, exactly as before Phase 8.
    expect(
      agentUpdateState({
        deviceAgent: "js",
        channel: jsChannel,
        installedVersion: BUILD_JS.version,
      })
    ).toEqual({ kind: "up-to-date", latest: BUILD_JS })
    // The same body never reaches a Rust device.
    expect(
      agentUpdateState({
        deviceAgent: "rust",
        channel: rustChannel,
        installedVersion: "aaaaaaa",
      })
    ).toEqual({ kind: "unknown" })
    // An old backend with no manifest 404s: no dot, as today.
    request.mockRejectedValueOnce(
      new XorgateError({ code: "NOT_FOUND", message: "x", status: 404 })
    )
    expect(await fetchAgentChannel("js")).toEqual(UNSUPPORTED_CHANNEL)
  })

  it("asks ?agent= and reads a 404 as unsupported, other errors throw", async () => {
    request.mockResolvedValueOnce({
      agent: "rust",
      latest: BUILD_RS,
      registrationEnabled: true,
    })
    expect((await fetchAgentChannel("rust")).agent).toBe("rust")
    expect(request).toHaveBeenCalledWith("GET", "/device-dist/latest", {
      query: { agent: "rust" },
    })

    request.mockRejectedValueOnce(
      new XorgateError({ code: "NOT_FOUND", message: "x", status: 404 })
    )
    expect(await fetchAgentChannel("rust")).toEqual(UNSUPPORTED_CHANNEL)

    request.mockRejectedValueOnce(
      new XorgateError({ code: "SERVER_ERROR", message: "x", status: 500 })
    )
    await expect(fetchAgentChannel("rust")).rejects.toThrow()
  })
})

describe("the Rust option", () => {
  const ok = { agent: "rust", latest: BUILD_RS, registrationEnabled: true }

  it("is enabled only when the channel echoes rust, the flag is on and a build exists", () => {
    expect(rustOption(ok)).toEqual({ state: "enabled" })
  })
  it("is checking while the channel loads", () => {
    expect(rustOption(undefined)).toEqual({ state: "checking" })
  })
  it("names the old API when nothing echoes rust", () => {
    expect(rustOption(UNSUPPORTED_CHANNEL)).toEqual({
      state: "disabled",
      reason: RUST_REASON_OLD_API,
    })
    // An old backend's JS manifest must never read as the Rust one.
    expect(
      rustOption({ agent: "js", latest: BUILD_JS, registrationEnabled: true })
    ).toEqual({
      state: "disabled",
      reason: RUST_REASON_OLD_API,
    })
  })
  it("N1: a failed check gets its own reason, not the old-API one", () => {
    expect(rustOption(null)).toEqual({
      state: "disabled",
      reason: RUST_REASON_CHECK_FAILED,
    })
    expect(RUST_REASON_CHECK_FAILED).not.toBe(RUST_REASON_OLD_API)
  })
  it("names the stage flag (registrationEnabled:false, or a 409 from create)", () => {
    expect(rustOption({ ...ok, registrationEnabled: false })).toEqual({
      state: "disabled",
      reason: RUST_REASON_FLAG_OFF,
    })
    expect(rustOption(ok, true)).toEqual({
      state: "disabled",
      reason: RUST_REASON_FLAG_OFF,
    })
    expect(rustOption(undefined, true)).toEqual({
      state: "disabled",
      reason: RUST_REASON_FLAG_OFF,
    })
  })
  it("names a missing release", () => {
    expect(rustOption({ ...ok, latest: null })).toEqual({
      state: "disabled",
      reason: RUST_REASON_NO_RELEASE,
    })
  })
  it("spots a CM4 model by its platform", () => {
    const model = (platform: string | null) =>
      ({
        id: "m",
        name: "n",
        sku: "s",
        ioCapabilities: platform ? { system: { platform } } : null,
      }) as unknown as DeviceModel
    expect(isCm4Model(model("rpi-cm4"))).toBe(true)
    expect(isCm4Model(model("rpi-cm5"))).toBe(false)
    expect(isCm4Model(model(null))).toBe(false)
    expect(isCm4Model(null)).toBe(false)
  })
})

describe("device agents", () => {
  it("reads devices.agent off the raw device, js when absent", async () => {
    request.mockResolvedValueOnce({ device: { id: "d1", agent: "rust" } })
    expect(await fetchDeviceAgent("d1")).toBe("rust")
    expect(request).toHaveBeenLastCalledWith("GET", "/devices/d1")
    request.mockResolvedValueOnce({ device: { id: "d1" } })
    expect(await fetchDeviceAgent("d1")).toBe("js")
  })

  it("maps the whole fleet, paging", async () => {
    request
      .mockResolvedValueOnce({
        devices: Array.from({ length: 500 }, (_, i) => ({
          id: `d${i}`,
          agent: i === 0 ? "rust" : undefined,
        })),
        page: { total: 501 },
      })
      .mockResolvedValueOnce({
        devices: [{ id: "last", agent: "rust" }],
        page: { total: 501 },
      })
    const map = await fetchFleetAgents()
    expect(Object.keys(map)).toHaveLength(501)
    expect(map["d0"]).toBe("rust")
    expect(map["d1"]).toBe("js")
    expect(map["last"]).toBe("rust")
    expect(request).toHaveBeenNthCalledWith(2, "GET", "/devices", {
      query: { limit: 500, offset: 500 },
    })
  })
})

describe("agent-aware update check", () => {
  const rs = { agent: "rust", latest: BUILD_RS, registrationEnabled: true }
  const js = { agent: "js", latest: BUILD_JS, registrationEnabled: true }

  it("compares a Rust device against the Rust channel", () => {
    expect(
      agentUpdateState({
        deviceAgent: "rust",
        channel: rs,
        installedVersion: "aaaaaaa",
      })
    ).toEqual({
      kind: "update-available",
      latest: BUILD_RS,
    })
    expect(
      agentUpdateState({
        deviceAgent: "rust",
        channel: rs,
        installedVersion: "14413e0",
      })
    ).toEqual({
      kind: "up-to-date",
      latest: BUILD_RS,
    })
  })

  it("never uses a channel that did not echo the device's agent", () => {
    // An old backend answering ?agent=rust with the JS manifest.
    expect(
      agentUpdateState({
        deviceAgent: "rust",
        channel: js,
        installedVersion: "aaaaaaa",
      })
    ).toEqual({
      kind: "unknown",
    })
    expect(
      agentUpdateState({
        deviceAgent: "js",
        channel: UNSUPPORTED_CHANNEL,
        installedVersion: "aaaaaaa",
      })
    ).toEqual({ kind: "unknown" })
    expect(
      agentUpdateState({
        deviceAgent: "js",
        channel: null,
        installedVersion: "x",
      })
    ).toEqual({
      kind: "unknown",
    })
  })

  it("asks nothing for an agent this console does not know", () => {
    expect(
      agentUpdateState({
        deviceAgent: "go",
        channel: { ...rs, agent: "go" },
        installedVersion: "x",
      })
    ).toEqual({ kind: "unknown" })
    expect(
      agentUpdateState({
        deviceAgent: null,
        channel: js,
        installedVersion: "x",
      })
    ).toEqual({
      kind: "unknown",
    })
  })

  it("says no-build (never update-available) when nothing is published", () => {
    expect(
      agentUpdateState({
        deviceAgent: "rust",
        channel: { ...rs, latest: null },
        installedVersion: "aaaaaaa",
      })
    ).toEqual({ kind: "no-build" })
  })

  it("does not flag a device that never reported a build", () => {
    expect(
      agentUpdateState({
        deviceAgent: "js",
        channel: js,
        installedVersion: null,
      })
    ).toEqual({
      kind: "unreported",
      latest: BUILD_JS,
    })
  })
})
