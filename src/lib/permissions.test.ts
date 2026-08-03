import { describe, it, expect } from "vitest"
import { roleHasPermission, rolesWithPermission } from "./permissions"

describe("roleHasPermission", () => {
  it("gives owners everything", () => {
    expect(roleHasPermission("owner", "billing:manage")).toBe(true)
    expect(roleHasPermission("owner", "api-keys:manage")).toBe(true)
  })

  it("withholds billing from admins", () => {
    expect(roleHasPermission("admin", "api-keys:manage")).toBe(true)
    expect(roleHasPermission("admin", "billing:manage")).toBe(false)
  })

  it("limits members to reading the roster", () => {
    expect(roleHasPermission("member", "members:read")).toBe(true)
    expect(roleHasPermission("member", "members:manage")).toBe(false)
  })

  it("grants viewers nothing gated", () => {
    expect(roleHasPermission("viewer", "members:read")).toBe(false)
    expect(roleHasPermission("viewer", "workspace:manage")).toBe(false)
  })
})

describe("rolesWithPermission", () => {
  it("lists the roles the 403 screen should name", () => {
    expect(rolesWithPermission("billing:manage")).toEqual(["owner"])
    expect(rolesWithPermission("workspace:manage")).toEqual(["owner", "admin"])
    expect(rolesWithPermission("members:read")).toEqual([
      "owner",
      "admin",
      "member",
    ])
  })
})
