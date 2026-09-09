import { describe, expect, it } from "vitest"
import {
  MAX_TAGS_PER_TEMPLATE,
  MAX_TAG_LENGTH,
  normalizeTag,
  workflowTemplateSummarySchema,
} from "./workflow-schemas"

/**
 * The tag rules are mirrored from the backend's `src/utils/tags.ts` so the tag
 * editor can refuse a value without a round trip. These tests are what keeps
 * the mirror honest: if the platform loosens or tightens a rule, this is the
 * file that has to change with it.
 */
describe("normalizeTag", () => {
  it("corrects case and surrounding whitespace", () => {
    expect(normalizeTag("  Geofence  ")).toBe("geofence")
    expect(normalizeTag("ZONE-A")).toBe("zone-a")
  })

  it("accepts digits, dot, underscore and hyphen after the first character", () => {
    for (const tag of ["geofence", "zone-a", "v1.2", "alocate_geofence", "4wd"]) {
      expect(normalizeTag(tag), tag).toBe(tag)
    }
  })

  it("refuses what the API would refuse", () => {
    for (const tag of ["", "   ", "-leading", ".x", "_x", "has space", "a/b", "a,b", "tag#1"]) {
      expect(normalizeTag(tag), tag).toBeNull()
    }
  })

  it("refuses one character over the maximum", () => {
    expect(normalizeTag("a".repeat(MAX_TAG_LENGTH))).toBe("a".repeat(MAX_TAG_LENGTH))
    expect(normalizeTag("a".repeat(MAX_TAG_LENGTH + 1))).toBeNull()
  })

  it("agrees with the platform cap", () => {
    expect(MAX_TAGS_PER_TEMPLATE).toBe(20)
    expect(MAX_TAG_LENGTH).toBe(32)
  })
})

describe("the summary schema", () => {
  const row = {
    id: "t1",
    name: "Geofence",
    slug: "geofence",
    description: null,
    status: "draft",
    currentVersion: 1,
    publishedVersion: null,
    usedBy: 0,
    createdBy: { id: "u1", name: "A", email: "a@example.test" },
    updatedBy: { id: "u1", name: "A", email: "a@example.test" },
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  }

  it("reads the tags the API sends", () => {
    expect(workflowTemplateSummarySchema.parse({ ...row, tags: ["geofence"] }).tags).toEqual([
      "geofence",
    ])
  })

  it("defaults to empty, so an API deployment without tags still renders", () => {
    expect(workflowTemplateSummarySchema.parse(row).tags).toEqual([])
  })
})
