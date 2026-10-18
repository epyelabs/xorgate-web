import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { IoCapabilities, LatestReading } from "@xorgate/sdk"
import { TooltipProvider } from "@/components/ui/tooltip"
import { deviceStatusDotModel } from "@/lib/device-status"
import { DeviceStatusDot } from "./device-status-dot"
import { DeviceStatusDetail } from "./device-status-info"
import { TelemetryPanel } from "./telemetry-panel"

// Static markup (node env, no DOM harness): the dialog body is portalled on
// open, so DeviceStatusDetail is rendered on its own.
const wrap = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(TooltipProvider, null, el))

describe("DeviceStatusDot", () => {
  it("is a labelled button with the LED colour, no text", () => {
    const html = wrap(
      createElement(DeviceStatusDot, {
        ledState: 3,
        healthFlags: 4,
        online: true,
      })
    )
    expect(html).toContain('aria-label="Device status"')
    expect(html).toContain('data-testid="device-status-dot"')
    expect(html).toContain("cursor-pointer")
    expect(html).toContain("background-color:#a855f7")
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).not.toContain(">Network recovering<")
  })

  it("is not rendered while healthy (R1f)", () => {
    expect(
      wrap(
        createElement(DeviceStatusDot, {
          ledState: 0,
          healthFlags: 0,
          online: true,
        })
      )
    ).toBe("")
  })

  it("takes the current code's colour", () => {
    const html = wrap(
      createElement(DeviceStatusDot, {
        ledState: 5,
        healthFlags: 1,
        online: true,
      })
    )
    expect(html).toContain('data-code="5"')
    expect(html).toContain("background-color:#ef4444")
  })

  it("renders nothing offline or without a reading", () => {
    expect(
      wrap(createElement(DeviceStatusDot, { ledState: 3, online: false }))
    ).toBe("")
    expect(wrap(createElement(DeviceStatusDot, { online: true }))).toBe("")
  })
})

describe("DeviceStatusDetail", () => {
  it("shows the state, its meaning and the reported faults", () => {
    const model = deviceStatusDotModel({
      ledState: 3,
      healthFlags: 4 | 8,
      online: true,
    })!
    const html = renderToStaticMarkup(
      createElement(DeviceStatusDetail, { model })
    )
    expect(html).toContain("Network recovering")
    expect(html).toContain("background-color:#a855f7")
    expect(html).toContain("LTE or the cloud link is down")
    expect(html).toContain("Reported faults")
    expect(html).toContain("<li>LTE down</li>")
    expect(html).toContain("<li>Cloud link down</li>")
  })

  it("ends with the colour key of every code", () => {
    const model = deviceStatusDotModel({ ledState: 2, online: true })!
    const html = renderToStaticMarkup(
      createElement(DeviceStatusDetail, { model })
    )
    const key = html.slice(html.indexOf("Colour key"))
    expect(html.indexOf("Colour key")).toBeGreaterThan(
      html.indexOf("Reported faults")
    )
    for (const code of [0, 1, 2, 3, 4, 5, 6]) {
      expect(key).toContain(`data-code="${code}"`)
    }
    expect(key).toContain("Agent down")
    expect(html).not.toContain("Approximate:")
    const approx = renderToStaticMarkup(
      createElement(DeviceStatusDetail, { model, source: "overview" })
    )
    expect(approx).toContain(
      "Approximate: built from overview buckets, not exact samples."
    )
  })

  it("says None when no faults are set", () => {
    const model = deviceStatusDotModel({
      ledState: 0,
      healthFlags: 0,
      online: true,
    })!
    const html = renderToStaticMarkup(
      createElement(DeviceStatusDetail, { model })
    )
    expect(html).toContain(">None<")
  })
})

describe("TelemetryPanel (Map view System card)", () => {
  const caps: IoCapabilities = {
    schemaVersion: 2,
    system: {
      platform: "rpi-cm5",
      fields: ["cpu_usage", "led_state", "health_flags"],
    },
  }
  const reading = (value: number): LatestReading =>
    ({ value, ts: 0 }) as unknown as LatestReading
  const latest = {
    "system.cpu_usage": reading(12),
    "system.led_state": reading(2),
    "system.health_flags": reading(16),
  }

  it("has no status tiles, only the dot", () => {
    const html = wrap(createElement(TelemetryPanel, { caps, latest }))
    expect(html).toContain("CPU")
    expect(html).not.toContain("Health flags")
    expect(html).not.toContain(">Device status<")
    expect(html).toContain('data-testid="device-status-dot"')
    expect(html).toContain("background-color:#3b82f6")
  })

  it("hides the dot while offline", () => {
    const html = wrap(
      createElement(TelemetryPanel, { caps, latest, online: false })
    )
    expect(html).not.toContain("device-status-dot")
  })
})
