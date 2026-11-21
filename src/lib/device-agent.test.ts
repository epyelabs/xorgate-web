import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  XorgateError,
  createClient,
  isAgentKind,
  type AgentBuild,
  type DeviceModel,
  type XorgateClient,
} from "@xorgate/sdk"

// A REAL SDK 0.17.0 client over a fake fetch, so every test below pins what
// actually goes over the wire (method, path, query, body) and what the SDK's
// own normalisation hands the console — not a mock of the SDK.
type Reply = { status: number; body?: unknown }
const replies: Reply[] = []
const calls: { method: string; url: URL; body: string | undefined }[] = []

const fakeFetch = vi.fn(async (input: string, init?: RequestInit) => {
  calls.push({
    method: init?.method ?? "GET",
    url: new URL(input),
    body: typeof init?.body === "string" ? init.body : undefined,
  })
  const r = replies.shift()
  if (!r) throw new Error(`unexpected request ${init?.method} ${input}`)
  return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
    status: r.status,
    headers: { "content-type": "application/json" },
  })
})

function client(workspaceId: string | undefined): XorgateClient {
  return createClient({
    baseUrl: "https://api.example",
    auth: { getToken: async () => "t" },
    organizationId: "org-1",
    ...(workspaceId ? { workspaceId } : {}),
    fetch: fakeFetch,
  })
}

let current: XorgateClient = client("ws-1")
vi.mock("@/lib/xorgate", () => ({ xg: () => current }))

const {
  agentChannelQuery,
  agentUpdateState,
  createRegistration,
  currentDeviceAgent,
  defaultRegistrationAgent,
  fetchAgentChannel,
  isAgentNotEnabled,
  isCm4Model,
  registerPickOptions,
  registrationBody,
  registrationInput,
  registrationMatchesPick,
  rustOption,
  updaterUnit,
  REGISTER_PICK_LABEL,
  REGISTER_PICK_ORDER,
  RUST_CHECK_DEADLINE_MS,
  RUST_HINT_CM4,
  RUST_REASON_FLAG_OFF,
  RUST_REASON_NO_RELEASE,
  RUST_REASON_CHECK_FAILED,
  RUST_REASON_OLD_API,
  UNSUPPORTED_CHANNEL,
} = await import("./device-agent")

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

/** The registration row an old backend returns: no `agent` at all. */
const REG_OLD = {
  code: "ABCD1234",
  status: "pending",
  deviceId: null,
  expiresAt: "2026-11-14T20:00:00Z",
  installUrl: "https://api.example/get/ABCD1234",
}

const NOT_FOUND = { status: 404, body: { message: "Not Found" } }

function reply(...r: Reply[]) {
  replies.push(...r)
}

beforeEach(() => {
  replies.length = 0
  calls.length = 0
  fakeFetch.mockClear()
  current = client("ws-1")
})

describe("agent kinds", () => {
  it("narrows only js and rust", () => {
    expect(isAgentKind("js")).toBe(true)
    expect(isAgentKind("rust")).toBe(true)
    expect(isAgentKind("go")).toBe(false)
    expect(isAgentKind(undefined)).toBe(false)
    expect(isAgentKind(null)).toBe(false)
  })

  it("reads device.agent off the device itself: js when absent (old backend), unknown values passed through", async () => {
    // The fields the extra raw GET /devices and GET /devices/{id} reads used
    // to fetch now arrive on the SDK's own reads.
    reply({
      status: 200,
      body: {
        devices: [
          { id: "d0", agent: "rust" },
          { id: "d1" },
          { id: "d2", agent: "go" },
        ],
        page: { total: 3, limit: 50, offset: 0 },
      },
    })
    const { items } = await current.devices.list()
    expect(items.map((d) => d.agent)).toEqual(["rust", "js", "go"])
    expect(isAgentKind(items[2].agent)).toBe(false)

    reply({ status: 200, body: { device: { id: "d1" } } })
    expect((await current.devices.get("d1")).agent).toBe("js")
    reply({ status: 200, body: { device: { id: "d0", agent: "rust" } } })
    expect((await current.devices.get("d0")).agent).toBe("rust")
  })

  it("names the updater unit per agent", () => {
    expect(updaterUnit("js")).toBe("xorgate-updater")
    expect(updaterUnit("rust")).toBe("xorgate-updater-rs")
    expect(updaterUnit(null)).toBe("xorgate-updater")
    expect(updaterUnit(undefined)).toBe("xorgate-updater")
  })
})

describe("registrations", () => {
  it("leaves agent out for JS, so a plain JS registration sends no body, exactly as before Phase 8", () => {
    expect(registrationInput({ agent: "js" })).toEqual({})
    expect(registrationInput({ agent: "js", deviceModelId: "m1" })).toEqual({
      deviceModelId: "m1",
    })
    expect(registrationInput({ agent: "rust" })).toEqual({ agent: "rust" })
    expect(registrationInput({ agent: "rust", deviceModelId: "m1" })).toEqual({
      agent: "rust",
      deviceModelId: "m1",
    })
  })

  it("POSTs through the SDK with the right body (none at all for plain JS)", async () => {
    reply({ status: 200, body: { ...REG_OLD, agent: "rust" } })
    const r = await createRegistration({ agent: "rust", deviceModelId: "m1" })
    expect(calls[0].method).toBe("POST")
    expect(calls[0].url.pathname).toBe("/v1/device-registrations")
    expect(JSON.parse(calls[0].body ?? "null")).toEqual({
      deviceModelId: "m1",
      agent: "rust",
    })
    expect(r.agent).toBe("rust")

    reply({ status: 200, body: { ...REG_OLD, agent: "js" } })
    await createRegistration({ agent: "js" })
    expect(calls[1].method).toBe("POST")
    expect(calls[1].body).toBeUndefined()

    reply({ status: 200, body: { ...REG_OLD, agent: "js" } })
    await createRegistration({ agent: "js", deviceModelId: "m1" })
    expect(JSON.parse(calls[2].body ?? "null")).toEqual({ deviceModelId: "m1" })
  })

  it("adds the camera choice for Rust only: a JS registration never carries it", () => {
    // The API answers a JS registration that sends `cameras` with a 400.
    const cameras = { cam0: { sensor: "imx708" } }
    expect(registrationBody({ agent: "rust", cameras })).toEqual({
      agent: "rust",
      cameras,
    })
    expect(
      registrationBody({ agent: "rust", deviceModelId: "m1", cameras })
    ).toEqual({
      agent: "rust",
      deviceModelId: "m1",
      cameras,
    })
    expect(registrationBody({ agent: "js", cameras })).toEqual({})
    expect(
      registrationBody({ agent: "js", deviceModelId: "m1", cameras })
    ).toEqual({
      deviceModelId: "m1",
    })
    // Absent keeps a reused code's choice, so it is left out, not sent as null.
    expect(registrationBody({ agent: "rust" })).toEqual({ agent: "rust" })
    expect("cameras" in registrationBody({ agent: "rust" })).toBe(false)
  })

  it("re-pins the camera choice with one POST carrying `cameras`, and reads it back", async () => {
    const cameras = { cam0: { sensor: "imx708" }, cam1: { sensor: "none" } }
    reply({ status: 200, body: { ...REG_OLD, agent: "rust", cameras } })
    const r = await createRegistration({
      agent: "rust",
      deviceModelId: "m1",
      cameras,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe("POST")
    expect(calls[0].url.pathname).toBe("/v1/device-registrations")
    expect(JSON.parse(calls[0].body ?? "null")).toEqual({
      deviceModelId: "m1",
      agent: "rust",
      cameras,
    })
    expect(r).toMatchObject({ code: "ABCD1234", agent: "rust", cameras })
  })

  it("sends a JS create exactly as before even when handed a camera choice", async () => {
    reply({ status: 200, body: { ...REG_OLD, agent: "js" } })
    await createRegistration({
      agent: "js",
      cameras: { cam0: { sensor: "imx708" } },
    })
    expect(calls[0].body).toBeUndefined()
  })

  it("fills agent=js on the camera path too when an old backend omits it", async () => {
    // An old backend ignores both fields; the echo guard then hides the command.
    reply({ status: 200, body: REG_OLD })
    const r = await createRegistration({
      agent: "rust",
      cameras: { cam0: { sensor: "imx708" } },
    })
    expect(r.agent).toBe("js")
    expect(registrationMatchesPick(r, "rust")).toBe(false)
  })

  it("refuses the camera path locally without a workspace too", async () => {
    current = client(undefined)
    await expect(
      createRegistration({
        agent: "rust",
        cameras: { cam0: { sensor: "imx708" } },
      })
    ).rejects.toMatchObject({ code: "INVALID_CONFIG" })
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it("N3: refuses locally without a workspace, sending nothing", async () => {
    current = client(undefined)
    await expect(createRegistration({ agent: "js" })).rejects.toMatchObject({
      code: "INVALID_CONFIG",
      message: expect.stringContaining("Select one first"),
    })
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it("fills agent=js when the backend omits it (create and get)", async () => {
    reply({ status: 200, body: REG_OLD })
    expect((await createRegistration({ agent: "js" })).agent).toBe("js")
    reply({ status: 200, body: REG_OLD })
    expect((await current.deviceRegistrations.get("ABCD1234")).agent).toBe("js")
    expect(calls[1].method).toBe("GET")
    expect(calls[1].url.pathname).toBe("/v1/device-registrations/ABCD1234")
  })

  it("M1 echo guard: old backend + JS pick shows the command; Rust pick does not", async () => {
    // An old backend ignores `agent` and hands back a JS code with no field.
    reply({ status: 200, body: REG_OLD })
    const old = await createRegistration({ agent: "rust" })
    expect(registrationMatchesPick(old, "js")).toBe(true)
    expect(registrationMatchesPick(old, "rust")).toBe(false)
    // The raw row too (the guard's own `?? 'js'`).
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

  it("recognises AGENT_NOT_ENABLED, including a real 409 from create", async () => {
    reply({
      status: 409,
      body: {
        error: { code: "AGENT_NOT_ENABLED", message: "Rust is off here" },
      },
    })
    const err = await createRegistration({ agent: "rust" }).catch((e) => e)
    expect(isAgentNotEnabled(err)).toBe(true)
    expect(err).toMatchObject({ status: 409 })
    expect(
      isAgentNotEnabled(
        new XorgateError({ code: "CONFLICT", message: "x", status: 409 })
      )
    ).toBe(false)
    expect(isAgentNotEnabled(new Error("AGENT_NOT_ENABLED"))).toBe(false)
  })
})

describe("the agent channel", () => {
  it("asks ?agent= and reads a self-describing answer", async () => {
    reply({
      status: 200,
      body: { agent: "rust", latest: BUILD_RS, registrationEnabled: true },
    })
    expect(await fetchAgentChannel("rust")).toEqual({
      agent: "rust",
      latest: BUILD_RS,
      registrationEnabled: true,
    })
    expect(calls[0].url.pathname).toBe("/v1/device-dist/latest")
    expect(calls[0].url.searchParams.get("agent")).toBe("rust")

    reply({
      status: 200,
      body: { agent: "rust", latest: null, registrationEnabled: false },
    })
    expect(await fetchAgentChannel("rust")).toEqual({
      agent: "rust",
      latest: null,
      registrationEnabled: false,
    })
  })

  it("S1: an un-echoed body (old backend) is NEVER the Rust channel, and asks nothing else", async () => {
    for (const body of [{ latest: BUILD_JS }, null, [], { agent: "" }]) {
      reply({ status: 200, body })
      expect(await fetchAgentChannel("rust")).toEqual(UNSUPPORTED_CHANNEL)
    }
    // One request per check: Rust never falls back to the no-parameter route.
    expect(calls).toHaveLength(4)
    expect(calls.every((c) => c.url.searchParams.get("agent") === "rust")).toBe(
      true
    )
  })

  it("S1: an un-echoed body (old backend) IS the JS manifest when JS was asked", async () => {
    // Old backend: ignores ?agent= and answers today's { latest } shape, so
    // the console reads the JS manifest off the no-parameter route.
    reply({ status: 200, body: { latest: BUILD_JS } })
    reply({ status: 200, body: { latest: BUILD_JS } })
    expect(await fetchAgentChannel("js")).toEqual({
      agent: "js",
      latest: BUILD_JS,
      registrationEnabled: true,
    })
    expect(calls[0].url.searchParams.get("agent")).toBe("js")
    expect(calls[1].url.pathname).toBe("/v1/device-dist/latest")
    expect(calls[1].url.search).toBe("")

    // An echo always wins: no second request, and `latest: null` stands.
    reply({
      status: 200,
      body: { agent: "js", latest: null, registrationEnabled: true },
    })
    const echoed = await fetchAgentChannel("js")
    expect(echoed.latest).toBeNull()
    expect(echoed.agent).toBe("js")
    expect(calls).toHaveLength(3)
  })

  it("S1: a JS device on an old backend keeps today's update check and target version", async () => {
    reply({ status: 200, body: { latest: BUILD_JS } })
    reply({ status: 200, body: { latest: BUILD_JS } })
    const jsChannel = await fetchAgentChannel("js")
    reply({ status: 200, body: { latest: BUILD_JS } })
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
    // An old backend with no manifest 404s (both routes): no dot, as today.
    reply(NOT_FOUND, NOT_FOUND)
    expect(await fetchAgentChannel("js")).toEqual(UNSUPPORTED_CHANNEL)
  })

  it("reads a 404 (old backend or bare gateway) as unsupported; other errors throw", async () => {
    reply(NOT_FOUND)
    expect(await fetchAgentChannel("rust")).toEqual(UNSUPPORTED_CHANNEL)

    expect(calls).toHaveLength(1)

    // A gateway 5xx: the SDK's SERVER_ERROR, after exactly one request (an
    // extra, unexpected request would fail differently: "unexpected request").
    reply({ status: 500, body: { message: "Internal Server Error" } })
    await expect(fetchAgentChannel("rust")).rejects.toMatchObject({
      code: "SERVER_ERROR",
      status: 500,
    })
    expect(calls).toHaveLength(2)

    // The JS fallback's own failures throw too: ?agent=js, then the
    // no-parameter route, and nothing after it.
    reply({ status: 200, body: { latest: BUILD_JS } })
    reply({ status: 500, body: { message: "Internal Server Error" } })
    await expect(fetchAgentChannel("js")).rejects.toMatchObject({
      code: "SERVER_ERROR",
      status: 500,
    })
    expect(calls).toHaveLength(4)
    expect(calls[2].url.searchParams.get("agent")).toBe("js")
    expect(calls[3].url.search).toBe("")
  })

  it("N2: an unknown agent asks no channel and gets no dot", async () => {
    for (const agent of ["go", "", null, undefined] as const) {
      const q = agentChannelQuery(agent)
      expect(q.known).toBeNull()
      expect(q.enabled).toBe(false)
      // Even a forced run of the query answers without a request.
      expect(await q.queryFn()).toEqual(UNSUPPORTED_CHANNEL)
    }
    expect(fakeFetch).not.toHaveBeenCalled()
    expect(
      agentUpdateState({
        deviceAgent: "go",
        channel: undefined,
        installedVersion: "aaaaaaa",
      })
    ).toEqual({ kind: "unknown" })
    // A known agent is asked about, per agent.
    expect(agentChannelQuery("rust")).toMatchObject({
      known: "rust",
      enabled: true,
    })
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

describe("the Language picker (Rust first, Rust by default where offered)", () => {
  const ok = { agent: "rust", latest: BUILD_RS, registrationEnabled: true }
  // Every way Rust can be unavailable, each with its own reason.
  const disabled: [string, ReturnType<typeof rustOption>, string][] = [
    [
      "flag off",
      rustOption({ ...ok, registrationEnabled: false }),
      RUST_REASON_FLAG_OFF,
    ],
    ["409 from create", rustOption(ok, true), RUST_REASON_FLAG_OFF],
    ["old API (no echo)", rustOption(UNSUPPORTED_CHANNEL), RUST_REASON_OLD_API],
    [
      "old API (the JS manifest)",
      rustOption({ agent: "js", latest: BUILD_JS, registrationEnabled: true }),
      RUST_REASON_OLD_API,
    ],
    ["check failed", rustOption(null), RUST_REASON_CHECK_FAILED],
    ["no release", rustOption({ ...ok, latest: null }), RUST_REASON_NO_RELEASE],
  ]

  it('is labelled "Language" and lists Rust first, then JS', () => {
    expect(REGISTER_PICK_LABEL).toBe("Language")
    expect(REGISTER_PICK_ORDER).toEqual(["rust", "js"])
    expect(
      registerPickOptions({ state: "enabled" }, false).map((o) => o.label)
    ).toEqual(["Rust", "JS"])
  })

  it("defaults to Rust when the workspace can register it", () => {
    expect(defaultRegistrationAgent(rustOption(ok))).toBe("rust")
    const [rust, js] = registerPickOptions(rustOption(ok), false)
    expect(rust).toEqual({
      value: "rust",
      label: "Rust",
      disabled: false,
      title: undefined,
    })
    expect(js).toEqual({ value: "js", label: "JS", disabled: false })
  })

  it.each(disabled)(
    "defaults to JS when Rust is disabled (%s), and shows Rust disabled with its reason",
    (_, option, reason) => {
      expect(option).toEqual({ state: "disabled", reason })
      expect(defaultRegistrationAgent(option)).toBe("js")
      const [rust, js] = registerPickOptions(option, false)
      expect(rust).toMatchObject({
        value: "rust",
        disabled: true,
        title: reason,
      })
      expect(js).toMatchObject({ value: "js", disabled: false })
    }
  )

  it("decides nothing while the check is in flight (so nothing is minted yet)", () => {
    expect(defaultRegistrationAgent({ state: "checking" })).toBeNull()
    const [rust] = registerPickOptions({ state: "checking" }, false)
    expect(rust.disabled).toBe(true)
    expect(rust.title).toMatch(/^Checking whether/)
    // The deadline that then opens on JS anyway sits well under the SDK's 30 s.
    expect(RUST_CHECK_DEADLINE_MS).toBeGreaterThanOrEqual(3000)
    expect(RUST_CHECK_DEADLINE_MS).toBeLessThan(30_000)
  })

  it("CM4 only hints: Rust stays enabled and the default is unaffected", () => {
    const [rust] = registerPickOptions({ state: "enabled" }, true)
    expect(rust).toMatchObject({ disabled: false, title: RUST_HINT_CM4 })
    // A disabled reason still wins over the hint.
    const [off] = registerPickOptions(disabled[0][1], true)
    expect(off.title).toBe(RUST_REASON_FLAG_OFF)
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

  it("S1: a mid-session js -> rust flip (D9) moves the General tab to the Rust channel, never the JS manifest", async () => {
    // The settings hook's snapshot was taken at mount, while the device still
    // read js; its polls do not carry `agent`. The shared device query (the
    // header's, polled by the layout) then sees the D9 promotion.
    const snapshot = { agent: "js" }
    let shared: { agent: string } | undefined = { agent: "js" }
    expect(currentDeviceAgent(shared, snapshot)).toBe("js")

    // Before the flip: the JS channel, JS dot, JS updater.
    reply({
      status: 200,
      body: { agent: "js", latest: BUILD_JS, registrationEnabled: true },
    })
    const before = currentDeviceAgent(shared, snapshot)
    const jsQ = agentChannelQuery(before)
    expect(
      agentUpdateState({
        deviceAgent: before,
        channel: await jsQ.queryFn(),
        installedVersion: "aaaaaaa",
      })
    ).toEqual({ kind: "update-available", latest: BUILD_JS })
    expect(updaterUnit(before)).toBe("xorgate-updater")

    // The update installs a marker-carrying Rust build: the device now
    // reports the Rust sha, and the shared query reads agent=rust.
    shared = { agent: "rust" }
    const after = currentDeviceAgent(shared, snapshot)
    expect(after).toBe("rust")
    const rsQ = agentChannelQuery(after)
    expect(rsQ.known).toBe("rust")
    reply({
      status: 200,
      body: { agent: "rust", latest: BUILD_RS, registrationEnabled: true },
    })
    const rsChannel = await rsQ.queryFn()
    expect(calls.at(-1)?.url.searchParams.get("agent")).toBe("rust")
    // Up to date against the RUST channel, not "Update available: 09da38d".
    const state = agentUpdateState({
      deviceAgent: after,
      channel: rsChannel,
      installedVersion: BUILD_RS.version,
    })
    expect(state).toEqual({ kind: "up-to-date", latest: BUILD_RS })
    expect(JSON.stringify(state)).not.toContain(BUILD_JS.version)
    // And the JS channel, still cached for the old key, is never used for it.
    expect(
      agentUpdateState({
        deviceAgent: after,
        channel: { agent: "js", latest: BUILD_JS, registrationEnabled: true },
        installedVersion: BUILD_RS.version,
      })
    ).toEqual({ kind: "unknown" })
    // The update outcome hints name the Rust updater.
    expect(updaterUnit(after)).toBe("xorgate-updater-rs")

    // The snapshot is only the fallback while the shared entry is empty.
    expect(currentDeviceAgent(undefined, snapshot)).toBe("js")
    expect(currentDeviceAgent(undefined, undefined)).toBeNull()
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
