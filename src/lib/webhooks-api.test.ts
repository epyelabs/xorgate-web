import { describe, it, expect } from "vitest"
import { disabledLabel, nodeWebhookNames, urlHost, type WebhookEndpoint } from "./webhooks-api"

const node = (id: string, type: string, config: Record<string, unknown>) => ({
  id,
  type,
  data: { config },
})

describe("nodeWebhookNames", () => {
  it("maps output.event nodes with a webhook name, trimmed", () => {
    const names = nodeWebhookNames({
      nodes: [
        node("n1", "source.telemetry", { webhook: "not-an-event-node" }),
        node("n3", "output.event", { kind: "harsh_accel", webhook: " dispatch " }),
        node("n4", "output.event", { kind: "quiet" }),
        node("n5", "output.event", { kind: "blank", webhook: "  " }),
      ],
    })
    expect([...names]).toEqual([["n3", "dispatch"]])
  })

  it("tolerates a missing definition", () => {
    expect(nodeWebhookNames(null).size).toBe(0)
  })
})

describe("disabledLabel / urlHost", () => {
  it("names a 410 and an auto (failing) disable", () => {
    const ep = { disabledReason: "gone" } as WebhookEndpoint
    expect(disabledLabel(ep)).toBe("Disabled (410 Gone)")
    expect(disabledLabel({ disabledReason: "failing" } as WebhookEndpoint)).toBe("Disabled (kept failing)")
    expect(disabledLabel({ disabledReason: null } as WebhookEndpoint)).toBe("Disabled")
  })

  it("shows the host, or the raw string when it will not parse", () => {
    expect(urlHost("https://hooks.example.com/x?y=1")).toBe("hooks.example.com")
    expect(urlHost("not a url")).toBe("not a url")
  })
})
