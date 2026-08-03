import { describe, it, expect } from "vitest"
import { sanitizeRedirect } from "./auth-guard"

describe("sanitizeRedirect", () => {
  it("keeps same-origin paths", () => {
    expect(sanitizeRedirect("/devices")).toBe("/devices")
    expect(sanitizeRedirect("/devices/abc/telemetry?tab=raw")).toBe(
      "/devices/abc/telemetry?tab=raw"
    )
  })

  it("drops protocol-relative and absolute URLs", () => {
    expect(sanitizeRedirect("//evil.example")).toBeUndefined()
    expect(sanitizeRedirect("https://evil.example/devices")).toBeUndefined()
  })

  it("drops relative paths and non-strings", () => {
    expect(sanitizeRedirect("devices")).toBeUndefined()
    expect(sanitizeRedirect(undefined)).toBeUndefined()
    expect(sanitizeRedirect(42)).toBeUndefined()
  })
})
