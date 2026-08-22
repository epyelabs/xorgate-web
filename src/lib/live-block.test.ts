import { describe, expect, it } from "vitest"
import { resolveLiveBlock, type LiveBlockState } from "@xorgate/react"
import {
  GENERIC_LIVE_BLOCK,
  LIVE_BLOCK_DESCRIPTORS,
  describeLiveBlock,
  describeLiveBlockReason,
  formatBlockedFor,
  selectStreamTile,
} from "./live-block"

/**
 * The APP half of the live-stream gate (power_management_improvements plan,
 * Phase 3): the reason registry, the descriptor composition and the per-tile
 * precedence. The verdict itself (fail-open on absence, staleness, clock
 * clamping) moved to `@xorgate/react`'s `resolveLiveBlock` and is tested in
 * that package; these tests build states through the real package function so
 * the seam is exercised, not mocked.
 */

const NOW = 1_754_400_000_000

function blockedVia(
  liveBlock: { reason: string; detail: string; since: number },
  powerShed?: string
): Extract<LiveBlockState, { blocked: true }> {
  const state = resolveLiveBlock({
    status: "connected",
    recording: {
      liveBlock,
      ...(powerShed ? { powerShed } : {}),
    },
    receivedAt: NOW,
    now: NOW,
  })
  if (!state.blocked) throw new Error("expected a blocked state")
  return state
}

describe("describeLiveBlock — the reason registry (Q7)", () => {
  it.each(["gps-gate", "undervoltage", "thermal"] as const)(
    "%s renders its own copy",
    (reason) => {
      const d = describeLiveBlock(
        blockedVia({ reason, detail: "device prose", since: NOW })
      )
      expect(d.title).toBe(LIVE_BLOCK_DESCRIPTORS[reason].title)
      expect(d.title).not.toBe(GENERIC_LIVE_BLOCK.title)
    }
  )

  it("an UNKNOWN reason still gets a card, with generic copy", () => {
    // A newer device against an older web build is a normal deployment state,
    // and it is the one deliberate exception to fail-open: the device said
    // blocked, so we honour it rather than mounting a player against a master
    // that is not there.
    const d = describeLiveBlock(
      blockedVia({
        reason: "future-thing",
        detail: "something the device knows about and we do not",
        since: NOW,
      })
    )
    expect(d.title).toBe(GENERIC_LIVE_BLOCK.title)
    // The device's own words survive, so a screenshot still says something.
    expect(d.detail).toBe("something the device knows about and we do not")
  })

  it("describeLiveBlockReason is the only narrowing point", () => {
    expect(describeLiveBlockReason("thermal")).toBe(
      LIVE_BLOCK_DESCRIPTORS.thermal
    )
    expect(describeLiveBlockReason("")).toBe(GENERIC_LIVE_BLOCK)
    expect(describeLiveBlockReason("constructor")).toBe(GENERIC_LIVE_BLOCK)
  })

  it("carries the device's detail through verbatim, unparsed", () => {
    const detail = "rail 5.11V < 5.2V for 3s"
    const d = describeLiveBlock(
      blockedVia({ reason: "undervoltage", detail, since: NOW })
    )
    expect(d.detail).toBe(detail)
  })
})

describe("describeLiveBlock — a parked shed", () => {
  it("says so, and offers settings as the escape hatch", () => {
    const d = describeLiveBlock(
      blockedVia(
        { reason: "thermal", detail: "cpu 81.0°C >= 80°C for 15s", since: NOW },
        "parked:no-live"
      )
    )
    expect(d.description).toContain("will not resume")
    expect(d.action).toEqual({
      label: "Open power settings",
      to: "settings",
      tab: "power",
    })
  })

  it("an unparked shed keeps its own copy", () => {
    const d = describeLiveBlock(
      blockedVia(
        { reason: "thermal", detail: "cpu 81.0°C >= 80°C for 15s", since: NOW },
        "no-live"
      )
    )
    expect(d.description).not.toContain("will not resume")
  })
})

describe("describeLiveBlock — the elapsed note", () => {
  it("a skewed clock costs the garnish, not the block", () => {
    // Device booted with no RTC and never synced: the package clamps elapsedMs
    // to null, and the note is simply dropped.
    const d = describeLiveBlock(
      blockedVia({ reason: "thermal", detail: "d", since: 0 })
    )
    expect(d.note).toBeUndefined()
  })

  it("suppresses the elapsed note below ~30s, shows it after", () => {
    const at = (sinceMs: number) =>
      describeLiveBlock(
        blockedVia({ reason: "thermal", detail: "d", since: NOW - sinceMs })
      )
    expect(at(5_000).note).toBeUndefined()
    expect(at(125_000).note).toBe("Paused for 2m")
  })
})

describe("formatBlockedFor", () => {
  it.each([
    [30_000, "1m"], // floors to 0 but never reads "0m"
    [60_000, "1m"],
    [125_000, "2m"],
    [3_600_000, "1h"],
    [3_900_000, "1h 5m"],
  ])("%ims → %s", (ms, expected) => {
    expect(formatBlockedFor(ms)).toBe(expected)
  })
})

describe("selectStreamTile — precedence and the no-player guarantee", () => {
  const blockedState: LiveBlockState = blockedVia({
    reason: "thermal",
    detail: "cpu 66.1°C >= 60°C for 5s",
    since: NOW,
  })
  const openState: LiveBlockState = { blocked: false, why: "no-live-block" }

  it("a DISABLED camera beats a liveBlock", () => {
    // Device-level config outranks a transient condition: the camera would be
    // off either way, and "turned off" is the more useful thing to say.
    const sel = selectStreamTile({
      streamKey: "cam1",
      label: "Camera 1",
      cameraEnables: { cam1: false },
      liveBlock: blockedState,
    })
    expect(sel.kind).toBe("disabled")
    expect(sel.kind !== "player" && sel.descriptor.title).toBe(
      "Camera 1 is turned off"
    )
  })

  it("a liveBlock beats the player", () => {
    expect(
      selectStreamTile({
        streamKey: "cam0",
        label: "Camera 0",
        cameraEnables: { cam0: true },
        liveBlock: blockedState,
      }).kind
    ).toBe("blocked")
  })

  it("blocks EVERY channel at once — the block is device-wide", () => {
    // Rung 1 parks all masters; nothing here may acquire a single-camera
    // assumption, whatever a one-camera bench looks like.
    for (const streamKey of ["cam0", "cam1", "cam2", "cam3"]) {
      expect(
        selectStreamTile({
          streamKey,
          label: streamKey,
          cameraEnables: {},
          liveBlock: blockedState,
        }).kind
      ).toBe("blocked")
    }
  })

  it("an absent camera key means enabled", () => {
    expect(
      selectStreamTile({
        streamKey: "cam0",
        label: "Camera 0",
        cameraEnables: {},
        liveBlock: openState,
      }).kind
    ).toBe("player")
    expect(
      selectStreamTile({
        streamKey: "cam0",
        label: "Camera 0",
        cameraEnables: undefined,
        liveBlock: openState,
      }).kind
    ).toBe("player")
  })

  it.each([
    ["feed-not-connected"],
    ["no-payload"],
    ["stale-payload"],
    ["no-live-block"],
  ] as const)("fail-open case %s renders the PLAYER", (why) => {
    expect(
      selectStreamTile({
        streamKey: "cam0",
        label: "Camera 0",
        liveBlock: { blocked: false, why },
      }).kind
    ).toBe("player")
  })

  it("an unknown reason suppresses the player too", () => {
    const sel = selectStreamTile({
      streamKey: "cam0",
      label: "Camera 0",
      liveBlock: blockedVia({ reason: "future-thing", detail: "d", since: NOW }),
    })
    expect(sel.kind).toBe("blocked")
    expect(sel.kind !== "player" && sel.descriptor.title).toBe(
      GENERIC_LIVE_BLOCK.title
    )
  })

  it("clearing the block returns the player with no other state involved", () => {
    // The transition case: block appears, then goes away. Nothing latches,
    // because the selection is a pure function of the current verdict.
    const key = { streamKey: "cam0", label: "Camera 0", cameraEnables: {} }
    expect(selectStreamTile({ ...key, liveBlock: openState }).kind).toBe(
      "player"
    )
    expect(selectStreamTile({ ...key, liveBlock: blockedState }).kind).toBe(
      "blocked"
    )
    expect(selectStreamTile({ ...key, liveBlock: openState }).kind).toBe(
      "player"
    )
  })
})
