import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { DeviceStatusChip } from "./device-status-chip"

// The repo has no DOM test harness (node environment, no RTL), so the chip is
// rendered to static markup: enough to pin what the header shows. The tooltip
// body is portalled on hover; its text is mirrored in the trigger's aria-label.
function render(props: Parameters<typeof DeviceStatusChip>[0]): string {
  return renderToStaticMarkup(
    createElement(TooltipProvider, null, createElement(DeviceStatusChip, props))
  )
}

describe("DeviceStatusChip", () => {
  it("renders GPS wait (2) with the LED's blue dot and its flags", () => {
    const html = render({ ledState: 2, healthFlags: 16 | 32, online: true })
    expect(html).toContain('data-code="2"')
    expect(html).toContain("GPS: waiting for fix")
    expect(html).toContain("background-color:#3b82f6")
    expect(html).toContain(
      'aria-label="Device status: GPS: waiting for fix (GPS: no fix, GPS gate holding)"'
    )
  })

  it("renders network recovering (3) in purple", () => {
    const html = render({ ledState: 3, healthFlags: 4, online: true })
    expect(html).toContain("Network recovering")
    expect(html).toContain("background-color:#a855f7")
    expect(html).toContain("(LTE down)")
  })

  it("renders undervoltage (5) in red, flags or not", () => {
    const html = render({ ledState: 5, healthFlags: 0, online: true })
    expect(html).toContain("Undervoltage")
    expect(html).toContain("background-color:#ef4444")
    expect(html).toContain("(no flags set)")
  })

  it("renders nothing while healthy or offline", () => {
    expect(render({ ledState: 0, healthFlags: 0, online: true })).toBe("")
    expect(render({ ledState: 5, healthFlags: 1, online: false })).toBe("")
    expect(render({ ledState: null, online: true })).toBe("")
  })
})
