import { describe, expect, it } from "vitest"
import { telemetryPayloadSchema } from "./schemas"
import {
  GENERIC_LIVE_BLOCK,
  LIVE_BLOCK_DESCRIPTORS,
  LIVE_BLOCK_STALE_MS,
  describeLiveBlockReason,
  formatBlockedFor,
  liveBlockElapsedMs,
  resolveLiveBlock,
  selectStreamTile,
  type LiveBlockState,
} from "./live-block"

/**
 * The live-stream gate (power_management_improvements plan, Phase 3).
 *
 * The whole decision lives in pure functions precisely so these properties can
 * be pinned without a DOM: fail-open on every kind of absence, honour an
 * unknown reason anyway, and never let a transient block outrank a camera the
 * operator turned off.
 */

const NOW = 1_754_400_000_000

function recordingWith(
  liveBlock?: { reason: string; detail: string; since: number },
  powerShed?: string
) {
  return {
    ...(liveBlock ? { liveBlock } : {}),
    ...(powerShed ? { powerShed } : {}),
  }
}

describe("resolveLiveBlock — fail open on absence", () => {
  const blocked = {
    reason: "thermal",
    detail: "cpu 66.1°C >= 60°C for 5s",
    since: NOW - 120_000,
  }

  it.each(["connecting", "closed", "error"] as const)(
    "feed status %s never blocks, even with a live block in hand",
    (status) => {
      const state = resolveLiveBlock({
        status,
        recording: recordingWith(blocked),
        receivedAt: NOW - 500,
        now: NOW,
      })
      expect(state).toEqual({ blocked: false, why: "feed-not-connected" })
    }
  )

  it("no payload yet does not block", () => {
    expect(
      resolveLiveBlock({
        status: "connected",
        recording: null,
        receivedAt: null,
        now: NOW,
      })
    ).toEqual({ blocked: false, why: "no-payload" })
  })

  it("a recording block with no receipt time does not block", () => {
    // Defensive: the two travel together today, but a caller that forgets the
    // clock must not get a verdict it cannot age out.
    expect(
      resolveLiveBlock({
        status: "connected",
        recording: recordingWith(blocked),
        receivedAt: null,
        now: NOW,
      })
    ).toEqual({ blocked: false, why: "no-payload" })
  })

  it("a payload older than the staleness window does not block", () => {
    // The device dropped off the air mid-block while our broker connection
    // stayed up. Without this the tile would latch blocked with no way to clear.
    expect(
      resolveLiveBlock({
        status: "connected",
        recording: recordingWith(blocked),
        receivedAt: NOW - LIVE_BLOCK_STALE_MS,
        now: NOW,
      })
    ).toEqual({ blocked: false, why: "stale-payload" })
  })

  it("a payload just inside the staleness window still blocks", () => {
    const state = resolveLiveBlock({
      status: "connected",
      recording: recordingWith(blocked),
      receivedAt: NOW - LIVE_BLOCK_STALE_MS + 1,
      now: NOW,
    })
    expect(state.blocked).toBe(true)
  })

  it("an agent too old to send liveBlock does not block", () => {
    expect(
      resolveLiveBlock({
        status: "connected",
        recording: {},
        receivedAt: NOW - 500,
        now: NOW,
      })
    ).toEqual({ blocked: false, why: "no-live-block" })
  })

  it("a MALFORMED recording block arrives as null and does not block", () => {
    // The frontend schema's .catch(undefined) wraps the WHOLE recording object,
    // so a bad liveBlock nulls the entire block — same case as "no block".
    const parsed = telemetryPayloadSchema.parse({
      v: 1,
      deviceId: "dev-1",
      ts: NOW,
      metrics: {},
      recording: { enabled: "not-a-boolean", liveBlock: { reason: "thermal" } },
    })
    expect(parsed.recording).toBeUndefined()
    expect(
      resolveLiveBlock({
        status: "connected",
        recording: parsed.recording ?? null,
        receivedAt: NOW - 500,
        now: NOW,
      })
    ).toEqual({ blocked: false, why: "no-payload" })
  })
})

describe("resolveLiveBlock — the reason registry (Q7)", () => {
  it.each(["gps-gate", "undervoltage", "thermal"] as const)(
    "%s renders its own copy",
    (reason) => {
      const state = resolveLiveBlock({
        status: "connected",
        recording: recordingWith({
          reason,
          detail: "device prose",
          since: NOW,
        }),
        receivedAt: NOW,
        now: NOW,
      })
      expect(state.blocked).toBe(true)
      if (!state.blocked) return
      expect(state.reason).toBe(reason)
      expect(state.descriptor.title).toBe(LIVE_BLOCK_DESCRIPTORS[reason].title)
      expect(state.descriptor.title).not.toBe(GENERIC_LIVE_BLOCK.title)
    }
  )

  it("an UNKNOWN reason still blocks, with the generic card", () => {
    // A newer device against an older web build is a normal deployment state,
    // and it is the one deliberate exception to fail-open: the device said
    // blocked, so we honour it rather than mounting a player against a master
    // that is not there.
    const state = resolveLiveBlock({
      status: "connected",
      recording: recordingWith({
        reason: "future-thing",
        detail: "something the device knows about and we do not",
        since: NOW,
      }),
      receivedAt: NOW,
      now: NOW,
    })
    expect(state.blocked).toBe(true)
    if (!state.blocked) return
    expect(state.reason).toBe("future-thing")
    expect(state.descriptor.title).toBe(GENERIC_LIVE_BLOCK.title)
    // The device's own words survive, so a screenshot still says something.
    expect(state.descriptor.detail).toBe(
      "something the device knows about and we do not"
    )
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
    const state = resolveLiveBlock({
      status: "connected",
      recording: recordingWith({ reason: "undervoltage", detail, since: NOW }),
      receivedAt: NOW,
      now: NOW,
    })
    expect(state.blocked && state.descriptor.detail).toBe(detail)
  })
})

describe("resolveLiveBlock — a parked shed", () => {
  it("says so, and offers settings as the escape hatch", () => {
    const state = resolveLiveBlock({
      status: "connected",
      recording: recordingWith(
        { reason: "thermal", detail: "cpu 81.0°C >= 80°C for 15s", since: NOW },
        "parked:no-live"
      ),
      receivedAt: NOW,
      now: NOW,
    })
    expect(state.blocked).toBe(true)
    if (!state.blocked) return
    expect(state.descriptor.description).toContain("will not resume")
    expect(state.descriptor.action).toEqual({
      label: "Open power settings",
      to: "settings",
      tab: "power",
    })
  })

  it("an unparked shed keeps its own copy", () => {
    const state = resolveLiveBlock({
      status: "connected",
      recording: recordingWith(
        { reason: "thermal", detail: "cpu 81.0°C >= 80°C for 15s", since: NOW },
        "no-live"
      ),
      receivedAt: NOW,
      now: NOW,
    })
    expect(state.blocked && state.descriptor.description).not.toContain(
      "will not resume"
    )
  })
})

describe("liveBlockElapsedMs — the device's clock is not ours", () => {
  it("reports a plausible age", () => {
    expect(liveBlockElapsedMs(NOW - 125_000, NOW)).toBe(125_000)
  })

  it("refuses a NEGATIVE age (device clock ahead of the browser)", () => {
    // The 2026-07-24 rtc-vs-ntp observation: an unsynced device can stamp
    // `since` in our future. "Paused for -3m" is worse than saying nothing.
    expect(liveBlockElapsedMs(NOW + 60_000, NOW)).toBeNull()
  })

  it("refuses an implausible age (device clock stuck at the epoch)", () => {
    expect(liveBlockElapsedMs(0, NOW)).toBeNull()
  })

  it("a skewed clock costs the garnish, not the block", () => {
    const state = resolveLiveBlock({
      status: "connected",
      recording: recordingWith({
        reason: "thermal",
        detail: "cpu 81.0°C >= 80°C for 15s",
        since: 0, // device booted with no RTC and never synced
      }),
      receivedAt: NOW,
      now: NOW,
    })
    expect(state.blocked).toBe(true)
    expect(state.blocked && state.descriptor.note).toBeUndefined()
  })

  it("suppresses the elapsed note below ~30s, shows it after", () => {
    const at = (sinceMs: number) =>
      resolveLiveBlock({
        status: "connected",
        recording: recordingWith({
          reason: "thermal",
          detail: "d",
          since: NOW - sinceMs,
        }),
        receivedAt: NOW,
        now: NOW,
      })
    const short = at(5_000)
    expect(short.blocked && short.descriptor.note).toBeUndefined()
    const long = at(125_000)
    expect(long.blocked && long.descriptor.note).toBe("Paused for 2m")
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
  const blockedState: LiveBlockState = resolveLiveBlock({
    status: "connected",
    recording: recordingWith({
      reason: "thermal",
      detail: "cpu 66.1°C >= 60°C for 5s",
      since: NOW,
    }),
    receivedAt: NOW,
    now: NOW,
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
    const unknown = resolveLiveBlock({
      status: "connected",
      recording: recordingWith({
        reason: "future-thing",
        detail: "d",
        since: NOW,
      }),
      receivedAt: NOW,
      now: NOW,
    })
    const sel = selectStreamTile({
      streamKey: "cam0",
      label: "Camera 0",
      liveBlock: unknown,
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
