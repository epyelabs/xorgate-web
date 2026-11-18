// @vitest-environment jsdom
/**
 * Register device's Language picker, rendered (jsdom) over a REAL SDK 0.17.0
 * client and a fake fetch, so the counts below are the requests the dialog
 * actually sends: which agent it opens on, and how many codes it mints.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { createClient, type XorgateClient } from "@xorgate/sdk"

type Reply = { status: number; body?: unknown }
type Call = { method: string; url: URL; body: string | undefined }

const calls: Call[] = []
let route: (call: Call) => Reply | Promise<Reply>

const fakeFetch = vi.fn(async (input: string, init?: RequestInit) => {
  const call: Call = {
    method: init?.method ?? "GET",
    url: new URL(input),
    body: typeof init?.body === "string" ? init.body : undefined,
  }
  calls.push(call)
  const r = await route(call)
  return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
    status: r.status,
    headers: { "content-type": "application/json" },
  })
})

const current: XorgateClient = createClient({
  baseUrl: "https://api.example",
  auth: { getToken: async () => "t" },
  organizationId: "org-1",
  workspaceId: "ws-1",
  fetch: fakeFetch,
})

vi.mock("@/lib/xorgate", () => ({
  xg: () => current,
  xgMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
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
const reg = (agent: "js" | "rust") => ({
  code: `CODE-${agent}`,
  status: "pending",
  deviceId: null,
  agent,
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  installUrl: `https://api.example/get/CODE-${agent}`,
})

/** The answer to `GET /device-dist/latest?agent=rust` for this test. */
let channel: () => Reply | Promise<Reply>
/** The answer to a create, by the agent it asked for. */
let create: (agent: "js" | "rust") => Reply

function defaultRoute(call: Call): Reply | Promise<Reply> {
  const path = call.url.pathname
  if (path === "/v1/device-dist/latest") return channel()
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

let container: HTMLDivElement
let root: Root
let open = true
const onOpenChange = vi.fn((next: boolean) => {
  open = next
  render()
})

function render() {
  act(() => {
    root.render(createElement(ProvisionDeviceDialog, { open, onOpenChange }))
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

const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel)
const radio = (agent: "js" | "rust") => $(`[data-testid=agent-pick-${agent}]`)!
const checked = () =>
  [
    ...document.body.querySelectorAll('[role="radio"][aria-checked="true"]'),
  ].map((el) => el.textContent)

beforeEach(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0
  fakeFetch.mockClear()
  toastError.mockClear()
  onOpenChange.mockClear()
  route = defaultRoute
  channel = () => ({ status: 200, body: CHANNEL_ON })
  create = (agent) => ({ status: 200, body: reg(agent) })
  open = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
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
    // Exactly one code, for Rust, and only after the check answered.
    expect(postedAgents()).toEqual(["rust"])
    const channelAt = calls.findIndex(
      (c) => c.url.pathname === "/v1/device-dist/latest"
    )
    expect(channelAt).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf(posts()[0])).toBeGreaterThan(channelAt)
    expect(document.body.textContent).toContain(
      "https://api.example/get/CODE-rust"
    )
    expect($("[data-testid=agent-note-rust]")).not.toBeNull()
  })

  it.each<[string, () => Reply, string]>([
    [
      "flag off",
      () => ({
        status: 200,
        body: { ...CHANNEL_ON, registrationEnabled: false },
      }),
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
    "opens on JS when Rust is disabled (%s): one create, for JS, with no body; Rust disabled with its reason",
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
      // A click on the disabled Rust mints nothing.
      act(() => radio("rust").click())
      await settle()
      expect(postedAgents()).toEqual(["js"])
    }
  )

  it("409 AGENT_NOT_ENABLED on the Rust default falls back to JS and its code", async () => {
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
    expect(checked()).toEqual(["JS"])
    expect(radio("rust").getAttribute("aria-disabled")).toBe("true")
    expect(radio("rust").title).toBe(RUST_REASON_FLAG_OFF)
    expect(toastError).toHaveBeenCalledWith(
      `${RUST_REASON_FLAG_OFF}. Showing the JS installer.`
    )
    expect(document.body.textContent).toContain(
      "https://api.example/get/CODE-js"
    )
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

  it("a slow check mints nothing until the deadline, then opens on JS; the late answer never moves the pick", async () => {
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

    // The check finally says Rust is on: Rust becomes pickable, nothing else.
    await act(async () => {
      answer({ status: 200, body: CHANNEL_ON })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(checked()).toEqual(["JS"])
    expect(postedAgents()).toEqual(["js"])
    expect(radio("rust").getAttribute("aria-disabled")).toBeNull()
  })

  it("a reopen decides afresh: after a session that ended on JS, it opens on Rust with one Rust create", async () => {
    render()
    await settle()
    act(() => radio("js").click())
    await settle()
    expect(postedAgents()).toEqual(["rust", "js"])

    // Close through the dialog itself (Escape), then open again.
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    })
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    await settle()
    open = true
    render()
    await settle()

    expect(checked()).toEqual(["Rust"])
    expect(postedAgents()).toEqual(["rust", "js", "rust"])
    expect(
      calls.filter((c) => c.url.pathname === "/v1/device-dist/latest")
    ).toHaveLength(2)
  })
})
