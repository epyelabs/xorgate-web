import { describe, it, expect } from "vitest"
import { isWorkspaceScoped, shouldLeaveOnContextSwitch } from "./context-scope"

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

describe("isWorkspaceScoped", () => {
  it("covers the lists as well as the detail pages", () => {
    expect(isWorkspaceScoped("/devices")).toBe(true)
    expect(isWorkspaceScoped("/devices/abc-123")).toBe(true)
    expect(isWorkspaceScoped("/devices/abc-123/telemetry")).toBe(true)
    expect(isWorkspaceScoped("/workflow-instances")).toBe(true)
    expect(isWorkspaceScoped("/workflow-instances/run-9")).toBe(true)
  })

  it("leaves the organization-level pages alone", () => {
    expect(isWorkspaceScoped("/workflow-templates")).toBe(false)
    expect(isWorkspaceScoped("/workflow-templates/t-1")).toBe(false)
    expect(isWorkspaceScoped("/members")).toBe(false)
    expect(isWorkspaceScoped("/api-keys")).toBe(false)
    expect(isWorkspaceScoped("/settings")).toBe(false)
    expect(isWorkspaceScoped("/account")).toBe(false)
    expect(isWorkspaceScoped("/no-workspace")).toBe(false)
  })

  it("does not match a path that merely starts with the same letters", () => {
    // The trailing-boundary group is what keeps a future /devices-archive (or
    // a typo'd URL) from being read as the devices section.
    expect(isWorkspaceScoped("/devices-archive")).toBe(false)
    expect(isWorkspaceScoped("/workflow-instances-old")).toBe(false)
  })
})
