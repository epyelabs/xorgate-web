import { describe, it, expect } from "vitest"
import { shouldLeaveOnContextSwitch } from "./context-scope"

describe("shouldLeaveOnContextSwitch", () => {
  it("leaves workspace-scoped detail pages on either switch", () => {
    for (const scope of ["workspace", "organization"] as const) {
      expect(shouldLeaveOnContextSwitch("/devices/abc-123", scope)).toBe(true)
      expect(shouldLeaveOnContextSwitch("/devices/abc-123/telemetry", scope)).toBe(true)
      expect(shouldLeaveOnContextSwitch("/workflow-instances/run-9", scope)).toBe(true)
    }
  })

  it("keeps a workspace switch on an organization-scoped detail page", () => {
    // Templates belong to the organization, which a workspace switch leaves
    // untouched — the open template is still valid.
    expect(shouldLeaveOnContextSwitch("/workflow-templates/t-1", "workspace")).toBe(false)
    expect(shouldLeaveOnContextSwitch("/workflow-templates/t-1", "organization")).toBe(true)
  })

  it("stays on list pages, which refetch under the new context", () => {
    for (const scope of ["workspace", "organization"] as const) {
      expect(shouldLeaveOnContextSwitch("/devices", scope)).toBe(false)
      expect(shouldLeaveOnContextSwitch("/workflow-instances", scope)).toBe(false)
      expect(shouldLeaveOnContextSwitch("/workflow-templates", scope)).toBe(false)
    }
  })

  it("stays on organization-level pages", () => {
    for (const scope of ["workspace", "organization"] as const) {
      expect(shouldLeaveOnContextSwitch("/members", scope)).toBe(false)
      expect(shouldLeaveOnContextSwitch("/api-keys", scope)).toBe(false)
      expect(shouldLeaveOnContextSwitch("/billing", scope)).toBe(false)
      expect(shouldLeaveOnContextSwitch("/settings", scope)).toBe(false)
    }
  })
})
