// @vitest-environment jsdom
/**
 * Register device's Language picker, rendered (jsdom) over a REAL SDK 0.17.0
 * client and a fake fetch, so the counts below are the requests the dialog
 * actually sends: which agent it opens on, how many codes it mints, and how
 * often it asks the Rust channel (cached per org + workspace for 60 s).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, createElement, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createClient, type XorgateClient } from "@xorgate/sdk"

type Reply = { status: number; body?: unknown }
type Call = {
  method: string
  url: URL
  body: string | undefined
  ws: string | null
}

const calls: Call[] = []
let route: (call: Call) => Reply | Promise<Reply>

const fakeFetch = vi.fn(async (input: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  const call: Call = {
    method: init?.method ?? "GET",
    url: new URL(input),
    body: typeof init?.body === "string" ? init.body : undefined,
    ws: headers.get("x-workspace-id"),
  }
  calls.push(call)
  const r = await route(call)
  return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
    status: r.status,
    headers: { "content-type": "application/json" },
  })
})

// The active tenant: the query keys (useTenant) and the client's headers (xg)
// read the same value, as the app's store makes them.
const tenant = { org: "org-1", ws: "ws-1" }
const clients = new Map<string, XorgateClient>()
function clientFor(ws: string): XorgateClient {
  let c = clients.get(ws)
  if (!c) {
    c = createClient({
      baseUrl: "https://api.example",
      auth: { getToken: async () => "t" },
      organizationId: tenant.org,
      workspaceId: ws,
      fetch: fakeFetch,
    })
    clients.set(ws, c)
  }
  return c
}

vi.mock("@/lib/xorgate", () => ({
  xg: () => clientFor(tenant.ws),
  xgMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))
vi.mock("@/queries/tenant", () => ({
  useTenant: () => ({ orgId: tenant.org, wsId: tenant.ws, ready: true }),
}))
const toastError = vi.fn()
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }))

const { ProvisionDeviceDialog } = await import("./provision-device-dialog")
const {
  RUST_REASON_CHECK_FAILED,
  RUST_REASON_FLAG_OFF,
  RUST_REASON_NO_RELEASE,
  RUST_REASON_OLD_API,
  RUST_CHECK_DEADLINE_MS,
} = await import("@/lib/device-agent")
const { agentChannelKey } = await import("@/queries/device-agent")

const BUILD_RS = {
  version: "14413e0",
  channel: "dev",
  builtAt: "2026-11-14T18:22:22Z",
  packageVersion: "0.0.1",
  tarball: "xorgate-agent-rs-14413e0.tar.gz",
}
const CHANNEL_ON = {
  agent: "rust",
  latest: BUILD_RS,
  registrationEnabled: true,
}
const CHANNEL_OFF = { ...CHANNEL_ON, registrationEnabled: false }
const reg = (agent: "js" | "rust") => ({
  code: `CODE-${agent}`,
  status: "pending",
  deviceId: null,
  agent,
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  installUrl: `https://api.example/get/CODE-${agent}`,
})
const NEVER = () => new Promise<Reply>(() => {})

/** The answer to `GET /device-dist/latest?agent=rust`, per call. */
let channel: (call: Call) => Reply | Promise<Reply>
/** The answer to a create, by the agent it asked for. */
let create: (agent: "js" | "rust") => Reply

function defaultRoute(call: Call): Reply | Promise<Reply> {
  const path = call.url.pathname
  if (path === "/v1/device-dist/latest") return channel(call)
  if (path === "/v1/device-registrations" && call.method === "POST") {
    const body = call.body === undefined ? {} : JSON.parse(call.body)
    return create(body.agent === "rust" ? "rust" : "js")
  }
  // The model catalog: a failure just leaves it empty.
  return { status: 500, body: { error: { code: "INTERNAL", message: "x" } } }
}

const posts = () => calls.filter((c) => c.method === "POST")
/** The agent each create asked for (a JS create sends no body at all). */
const postedAgents = () =>
  posts().map((c) => (c.body === undefined ? "js" : JSON.parse(c.body).agent))
const channelCalls = () =>
  calls.filter((c) => c.url.pathname === "/v1/device-dist/latest")

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient
let open = true
let strict = false
const onOpenChange = vi.fn((next: boolean) => {
  open = next
  render()
})

function render() {
  const dialog = createElement(ProvisionDeviceDialog, { open, onOpenChange })
  const tree = createElement(
    QueryClientProvider,
    { client: queryClient },
    strict ? createElement(StrictMode, null, dialog) : dialog
  )
  act(() => {
    root.render(tree)
  })
}

/** Let every pending request and effect run (real timers). */
async function settle() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}

/** Close the way an operator does (Escape), which goes through the dialog. */
function pressEscape() {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    )
  })
}

const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const radio = (agent: "js" | "rust") => $(`[data-testid=agent-pick-${agent}]`)!
const checked = () =>
  [
    ...document.body.querySelectorAll('[role="radio"][aria-checked="true"]'),
  ].map((el) => el.textContent)
const focused = () =>
  (document.activeElement as HTMLElement | null)?.getAttribute("data-testid")

beforeEach(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0
  fakeFetch.mockClear()
  toastError.mockClear()
  onOpenChange.mockClear()
  tenant.ws = "ws-1"
  route = defaultRoute
  channel = () => ({ status: 200, body: CHANNEL_ON })
  create = (agent) => ({ status: 200, body: reg(agent) })
  open = true
  strict = false
  queryClient = new QueryClient()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  queryClient.clear()
  vi.useRealTimers()
})

describe("Register device: the Language picker", () => {
  it('is labelled "Language", lists Rust first, and opens on Rust where Rust is enabled: ONE create, for Rust', async () => {
    render()
    await settle()

    const group = $('[role="radiogroup"]')!
    const label = document.getElementById(
      group.getAttribute("aria-labelledby")!
    )
    expect(label?.textContent).toBe("Language")
    expect(document.body.textContent).not.toMatch(/\bAgent\b/)
    expect(
      [...group.querySelectorAll('[role="radio"]')].map((el) => el.textContent)
    ).toEqual(["Rust", "JS"])

    expect(checked()).toEqual(["Rust"])
    expect(radio("rust").getAttribute("aria-disabled")).toBeNull()
    // Exactly one code, for Rust, and only after the check answered. The
    // mount prefetch and the open's own read share ONE request.
    expect(postedAgents()).toEqual(["rust"])
    expect(channelCalls()).toHaveLength(1)
    expect(calls.indexOf(posts()[0])).toBeGreaterThan(
      calls.indexOf(channelCalls()[0])
    )
    expect(document.body.textContent).toContain(
      "https://api.example/get/CODE-rust"
    )
    expect($("[data-testid=agent-note-rust]")).not.toBeNull()
    // S1: focus is on the picked (and available) radio.
    expect(focused()).toBe("agent-pick-rust")
  })

  it.each<[string, () => Reply, string]>([
    [
      "flag off",
      () => ({ status: 200, body: CHANNEL_OFF }),
      RUST_REASON_FLAG_OFF,
    ],
    [
      "old API (404)",
      () => ({ status: 404, body: { message: "Not Found" } }),
      RUST_REASON_OLD_API,
    ],
    [
      "old API (un-echoed JS manifest)",
      () => ({ status: 200, body: { latest: BUILD_RS } }),
      RUST_REASON_OLD_API,
    ],
    [
      "no release",
      () => ({ status: 200, body: { ...CHANNEL_ON, latest: null } }),
      RUST_REASON_NO_RELEASE,
    ],
    [
      "check failed",
      () => ({
        status: 500,
        body: { error: { code: "INTERNAL", message: "x" } },
      }),
      RUST_REASON_CHECK_FAILED,
    ],
  ])(
    "opens on JS when Rust is disabled (%s): one create, for JS, with no body; Rust disabled with its reason; focus on JS",
    async (_, answer, reason) => {
      channel = answer
      render()
      await settle()

      expect(checked()).toEqual(["JS"])
      expect(postedAgents()).toEqual(["js"])
      expect(posts()[0].body).toBeUndefined()
      expect(radio("rust").getAttribute("aria-disabled")).toBe("true")
      expect(radio("rust").title).toBe(reason)
      expect($("[data-testid=rust-unavailable-reason]")?.textContent).toBe(
        `Rust: ${reason}.`
      )
      expect(document.body.textContent).toContain(
        "https://api.example/get/CODE-js"
      )
      // S1: focus moved off the unavailable Rust radio onto the pick.
      expect(focused()).toBe("agent-pick-js")
      // A click on the disabled Rust mints nothing.
      act(() => radio("rust").click())
      await settle()
      expect(postedAgents()).toEqual(["js"])
    }
  )

  it("409 AGENT_NOT_ENABLED on the Rust default falls back to JS and its code (focus follows), and forgets the cached answer", async () => {
    create = (agent) =>
      agent === "rust"
        ? {
            status: 409,
            body: { error: { code: "AGENT_NOT_ENABLED", message: "off" } },
          }
        : { status: 200, body: reg("js") }
    render()
    await settle()

    expect(postedAgents()).toEqual(["rust", "js"])
    expect(posts()[1].body).toBeUndefined()
    expect(checked()).toEqual(["JS"])
    expect(focused()).toBe("agent-pick-js")
    expect(radio("rust").getAttribute("aria-disabled")).toBe("true")
    expect(radio("rust").title).toBe(RUST_REASON_FLAG_OFF)
    expect(toastError).toHaveBeenCalledWith(
      `${RUST_REASON_FLAG_OFF}. Showing the JS installer.`
    )
    expect(document.body.textContent).toContain(
      "https://api.example/get/CODE-js"
    )

    // The cached "enabled" was wrong, so the next open asks again.
    channel = () => ({ status: 200, body: CHANNEL_OFF })
    pressEscape()
    await settle()
    open = true
    render()
    await settle()
    expect(channelCalls()).toHaveLength(2)
    expect(checked()).toEqual(["JS"])
    expect(postedAgents()).toEqual(["rust", "js", "js"])
  })

  it("switching to JS creates (or reuses) a JS code; back to Rust, a Rust one: one create per switch", async () => {
    render()
    await settle()
    expect(postedAgents()).toEqual(["rust"])

    act(() => radio("js").click())
    await settle()
    expect(checked()).toEqual(["JS"])
    expect(postedAgents()).toEqual(["rust", "js"])
    expect(posts()[1].body).toBeUndefined()
    expect(document.body.textContent).toContain(
      "https://api.example/get/CODE-js"
    )

    act(() => radio("rust").click())
    await settle()
    expect(checked()).toEqual(["Rust"])
    expect(postedAgents()).toEqual(["rust", "js", "rust"])
  })

  it("a slow uncached check mints nothing until the deadline, then opens on JS (no body); the late answer never moves the pick", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    })
    let answer!: (r: Reply) => void
    channel = () => new Promise<Reply>((resolve) => (answer = resolve))
    render()
    await act(() => vi.advanceTimersByTimeAsync(RUST_CHECK_DEADLINE_MS - 100))

    // Waiting: nothing checked, nothing minted, the spinner up.
    expect(checked()).toEqual([])
    expect(posts()).toEqual([])
    expect(document.body.textContent).toContain(
      "Generating a one-time install command"
    )

    await act(() => vi.advanceTimersByTimeAsync(200))
    expect(checked()).toEqual(["JS"])
    expect(postedAgents()).toEqual(["js"])
    expect(posts()[0].body).toBeUndefined()

    // The check finally says Rust is on: Rust becomes pickable, nothing else.
    await act(async () => {
      answer({ status: 200, body: CHANNEL_ON })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(checked()).toEqual(["JS"])
    expect(postedAgents()).toEqual(["js"])
    expect(radio("rust").getAttribute("aria-disabled")).toBeNull()
    expect(channelCalls()).toHaveLength(1)
  })

  it("a reopen decides afresh: after a session that ended on JS, it opens on Rust with one Rust create (from the cache)", async () => {
    render()
    await settle()
    act(() => radio("js").click())
    await settle()
    expect(postedAgents()).toEqual(["rust", "js"])

    pressEscape()
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    await settle()
    open = true
    render()
    await settle()

    expect(checked()).toEqual(["Rust"])
    expect(postedAgents()).toEqual(["rust", "js", "rust"])
    expect(channelCalls()).toHaveLength(1)
  })
})

describe("Register device: the cached Rust check (review S2)", () => {
  it("a page-mount prefetch makes the open instant: zero channel requests on open, the create sent at once", async () => {
    // The Devices page mounts the dialog closed; that alone warms the check.
    open = false
    render()
    await settle()
    expect(channelCalls()).toHaveLength(1)
    expect(posts()).toEqual([])

    // Any further check would hang forever; the open must not need one.
    channel = NEVER
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    })
    open = true
    render()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(channelCalls()).toHaveLength(1)
    expect(postedAgents()).toEqual(["rust"])
    expect(checked()).toEqual(["Rust"])
  })

  it("an open during the prefetch joins it: one channel request, one create", async () => {
    let answer!: (r: Reply) => void
    channel = () => new Promise<Reply>((resolve) => (answer = resolve))
    open = false
    render()
    await settle()
    open = true
    render()
    await settle()
    expect(posts()).toEqual([])
    answer({ status: 200, body: CHANNEL_ON })
    await settle()
    expect(channelCalls()).toHaveLength(1)
    expect(postedAgents()).toEqual(["rust"])
  })

  it("a workspace switch never uses the other workspace's answer: a fresh check, with that workspace's header", async () => {
    channel = (call) => ({
      status: 200,
      body: call.ws === "ws-2" ? CHANNEL_OFF : CHANNEL_ON,
    })
    render()
    await settle()
    expect(checked()).toEqual(["Rust"])
    pressEscape()
    await settle()

    tenant.ws = "ws-2"
    open = true
    render()
    await settle()
    expect(channelCalls().map((c) => c.ws)).toEqual(["ws-1", "ws-2"])
    expect(checked()).toEqual(["JS"])
    expect(posts().map((c) => [c.ws, c.body])).toEqual([
      ["ws-1", '{"agent":"rust"}'],
      ["ws-2", undefined],
    ])
    expect(
      queryClient.getQueryData(agentChannelKey("org-1", "ws-1", "rust"))
    ).toMatchObject({ registrationEnabled: true })
    expect(
      queryClient.getQueryData(agentChannelKey("org-1", "ws-2", "rust"))
    ).toMatchObject({ registrationEnabled: false })

    // And back: ws-1's own fresh answer, no new request.
    pressEscape()
    await settle()
    tenant.ws = "ws-1"
    open = true
    render()
    await settle()
    expect(channelCalls()).toHaveLength(2)
    expect(checked()).toEqual(["Rust"])
  })
})

describe("Register device: fix-check (review N7, N8)", () => {
  it("N8: a 409 flip to JS never steals focus from outside the group", async () => {
    let answer!: (r: Reply) => void
    route = (call) => {
      if (
        call.url.pathname === "/v1/device-registrations" &&
        call.method === "POST" &&
        call.body !== undefined
      )
        return new Promise<Reply>((r) => (answer = r))
      return defaultRoute(call)
    }
    render()
    await settle()
    const close = $("[data-slot=dialog-close]")!
    act(() => close.focus())
    expect(document.activeElement).toBe(close)
    answer({
      status: 409,
      body: { error: { code: "AGENT_NOT_ENABLED", message: "off" } },
    })
    await settle()
    expect(checked()).toEqual(["JS"])
    expect(document.activeElement).toBe(close)
  })

  it("N7: a tenant change while open never re-sends the last create; the new tenant decides afresh", async () => {
    // Not reachable from the UI (the dialog is modal), pinned anyway.
    channel = (call) => ({
      status: 200,
      body: call.ws === "ws-2" ? CHANNEL_OFF : CHANNEL_ON,
    })
    render()
    await settle()
    tenant.ws = "ws-2"
    render()
    await settle()
    expect(posts().map((c) => [c.ws, c.body])).toEqual([
      ["ws-1", '{"agent":"rust"}'],
      ["ws-2", undefined],
    ])
    expect(checked()).toEqual(["JS"])
  })
})

// Adopted from the review's race tests (review N3), adapted to the cache.
describe("Register device: races", () => {
  it("R-strict: StrictMode, mounted already open: ONE channel request, ONE create", async () => {
    strict = true
    render()
    await settle()
    expect(postedAgents()).toEqual(["rust"])
    expect(checked()).toEqual(["Rust"])
    expect(channelCalls()).toHaveLength(1)
  })

  it("R-strict-toggle: StrictMode, closed then opened: ONE create", async () => {
    strict = true
    open = false
    render()
    await settle()
    open = true
    render()
    await settle()
    expect(postedAgents()).toEqual(["rust"])
    expect(channelCalls()).toHaveLength(1)
  })

  it("R-close-during-check: the closed open's late answer never mints; the reopen decides from that (now cached) answer", async () => {
    let answer!: (r: Reply) => void
    channel = () => new Promise<Reply>((resolve) => (answer = resolve))
    render()
    await settle()
    expect(posts()).toEqual([])
    pressEscape()
    await settle()
    answer({ status: 200, body: CHANNEL_OFF })
    await settle()
    expect(posts()).toEqual([])

    open = true
    render()
    await settle()
    expect(channelCalls()).toHaveLength(1)
    expect(postedAgents()).toEqual(["js"])
    expect(checked()).toEqual(["JS"])
  })

  it("R-close-during-check (reopen before the answer): the reopen joins the same check, ONE create", async () => {
    let answer!: (r: Reply) => void
    channel = () => new Promise<Reply>((resolve) => (answer = resolve))
    render()
    await settle()
    pressEscape()
    await settle()
    open = true
    render()
    await settle()
    expect(posts()).toEqual([])
    answer({ status: 200, body: CHANNEL_ON })
    await settle()
    expect(channelCalls()).toHaveLength(1)
    expect(postedAgents()).toEqual(["rust"])
    expect(checked()).toEqual(["Rust"])
  })

  it("R-close-before-deadline: the old deadline never fires into the next open", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    })
    channel = NEVER
    render()
    await act(() => vi.advanceTimersByTimeAsync(5000))
    pressEscape()
    await act(() => vi.advanceTimersByTimeAsync(10))
    open = true
    render()
    await act(() => vi.advanceTimersByTimeAsync(4000))
    expect(posts()).toEqual([])
    await act(() => vi.advanceTimersByTimeAsync(4100))
    expect(postedAgents()).toEqual(["js"])
    expect(posts()[0].body).toBeUndefined()
  })

  it("R-unmount-during-check: no create after unmount", async () => {
    let answer!: (r: Reply) => void
    channel = () => new Promise<Reply>((resolve) => (answer = resolve))
    render()
    await settle()
    act(() => root.unmount())
    answer({ status: 200, body: CHANNEL_ON })
    await settle()
    expect(posts()).toEqual([])
    root = createRoot(container)
  })

  it("R-reg-stale-on-reopen: a reopen waiting on its check shows no old command and does not poll it", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    })
    render()
    await act(() => vi.advanceTimersByTimeAsync(50))
    expect(document.body.textContent).toContain("CODE-rust")
    pressEscape()
    await act(() => vi.advanceTimersByTimeAsync(10))
    // An expired cache, so the reopen has to wait for a check.
    queryClient.clear()
    let answer!: (r: Reply) => void
    channel = () => new Promise<Reply>((resolve) => (answer = resolve))
    open = true
    render()
    await act(() => vi.advanceTimersByTimeAsync(7000))
    expect(document.body.textContent).not.toContain("CODE-rust")
    expect(
      calls.filter(
        (c) =>
          c.method === "GET" &&
          c.url.pathname.startsWith("/v1/device-registrations/")
      )
    ).toEqual([])
    answer({ status: 200, body: CHANNEL_ON })
    await act(() => vi.advanceTimersByTimeAsync(50))
    expect(postedAgents()).toEqual(["rust", "rust"])
  })
})

describe("Register device: the camera selects (plans/support-other-camera-models)", () => {
  const CM5 = {
    id: "cm5",
    name: "Argus CM5",
    sku: "XG-CM5",
    ioCapabilities: {
      schemaVersion: 2,
      system: { platform: "rpi-cm5" },
      media: {
        video: [
          { key: "cam0", codec: "h264", connector: "csi0", sensor: "imx290" },
          { key: "cam1", codec: "h264", connector: "csi1", sensor: "imx290" },
        ],
      },
    },
  }
  /** As `defaultRoute`, with a model catalog that answers. */
  function routeWithModels(call: Call): Reply | Promise<Reply> {
    if (call.url.pathname === "/v1/device-models") {
      return { status: 200, body: { device_models: [CM5] } }
    }
    return defaultRoute(call)
  }
  const cameraSelect = (port: string) =>
    $(`[data-testid=register-camera-${port}]`)
  const posted = () =>
    posts().map((c) => (c.body === undefined ? {} : JSON.parse(c.body)))

  beforeEach(() => {
    route = routeWithModels
  })

  it("shows one select per port for Rust, pre-set from the model's sensor, and sends no cameras until one is picked", async () => {
    create = (agent) => ({
      status: 200,
      body: agent === "rust" ? { ...reg("rust"), cameras: null } : reg("js"),
    })
    render()
    await settle()

    expect(checked()).toEqual(["Rust"])
    expect($("[data-testid=register-cameras]")).not.toBeNull()
    expect(cameraSelect("cam0")?.textContent).toContain("Sony IMX290")
    expect(cameraSelect("cam1")?.textContent).toContain("Sony IMX290")
    // The pre-set is a display default: nothing is sent for it.
    expect(posted()).toEqual([{ agent: "rust" }])
  })

  it("shows what the code already carries, over the model's default", async () => {
    create = () => ({
      status: 200,
      body: {
        ...reg("rust"),
        cameras: { cam0: { sensor: "imx708" }, cam1: { sensor: "none" } },
      },
    })
    render()
    await settle()

    expect(cameraSelect("cam0")?.textContent).toContain("Sony IMX708")
    expect(cameraSelect("cam1")?.textContent).toContain("No camera")
  })

  it("shows no camera select for JS, and a JS create carries no cameras", async () => {
    channel = () => ({ status: 200, body: CHANNEL_OFF })
    render()
    await settle()

    expect(checked()).toEqual(["JS"])
    expect($("[data-testid=register-cameras]")).toBeNull()
    expect(posts()).toHaveLength(1)
    expect(posts()[0].body).toBeUndefined()
  })

  it("shows no camera select when the API does not carry a camera choice (no `cameras` key)", async () => {
    // A backend from before the feature would ignore a choice, silently.
    create = (agent) => ({ status: 200, body: reg(agent) })
    render()
    await settle()

    expect(checked()).toEqual(["Rust"])
    expect(document.body.textContent).toContain("CODE-rust")
    expect($("[data-testid=register-cameras]")).toBeNull()
  })

  it("drops the selects when the operator switches to JS, and never sends cameras for it", async () => {
    create = (agent) => ({
      status: 200,
      body:
        agent === "rust"
          ? { ...reg("rust"), cameras: { cam0: { sensor: "imx708" } } }
          : reg("js"),
    })
    render()
    await settle()
    expect($("[data-testid=register-cameras]")).not.toBeNull()

    act(() => radio("js").click())
    await settle()
    expect(checked()).toEqual(["JS"])
    expect($("[data-testid=register-cameras]")).toBeNull()
    expect(posted().map((b) => "cameras" in b)).toEqual([false, false])
  })
})
