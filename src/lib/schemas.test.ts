import { describe, expect, it } from "vitest"
import { telemetryPayloadSchema } from "./schemas"

/**
 * The `recording` block of the live MQTT telemetry payload
 * (power_management_improvements plan, Phase 2).
 *
 * Two properties matter more than the round-trip itself:
 *  - FAIL OPEN. Absence of `liveBlock` — no key, an agent too old to send one,
 *    a malformed block — must always resolve to "live is allowed" and must
 *    never cost the payload's metrics (README principle 1).
 *  - The reason is an OPEN string on the wire (Q7). A zod enum here would
 *    reject a future reason and, through the `.catch(undefined)` around the
 *    whole `recording` object, silently discard the entire block — a
 *    forward-compatible field turned into a fail-open hole. Narrowing belongs
 *    in the UI's reason→descriptor registry.
 */
describe("telemetryPayloadSchema — recording block", () => {
  const base = {
    v: 1 as const,
    deviceId: "dev-1",
    ts: 1_754_400_000_000,
    metrics: { system: { cpu_temp: { value: 61.2, unit: "C" } } },
  }
  const recording = {
    enabled: false,
    sessionId: null,
    backlogBytes: 0,
    backlogSegments: 0,
    droppedSegments: 0,
    uploading: false,
    lastUploadAt: null,
  }

  it("round-trips liveBlock, bootDefer and powerShed", () => {
    const parsed = telemetryPayloadSchema.parse({
      ...base,
      recording: {
        ...recording,
        bootDefer: "gating",
        powerShed: "no-live",
        liveBlock: {
          reason: "thermal",
          detail: "cpu 85.0°C >= 80°C for 15s",
          since: 1_754_399_880_000,
        },
      },
    })
    expect(parsed.recording?.bootDefer).toBe("gating")
    expect(parsed.recording?.powerShed).toBe("no-live")
    expect(parsed.recording?.liveBlock).toEqual({
      reason: "thermal",
      detail: "cpu 85.0°C >= 80°C for 15s",
      since: 1_754_399_880_000,
    })
  })

  it("an unknown reason survives parsing untouched (open set)", () => {
    const parsed = telemetryPayloadSchema.parse({
      ...base,
      recording: {
        ...recording,
        liveBlock: { reason: "kvs-master-failed", detail: "sdk libs missing", since: 1 },
      },
    })
    // A newer device against this build is normal: the block is preserved so
    // the UI can render its generic "Live view paused" card.
    expect(parsed.recording?.liveBlock?.reason).toBe("kvs-master-failed")
  })

  it("an agent too old to send liveBlock parses cleanly — absent means allowed", () => {
    const parsed = telemetryPayloadSchema.parse({ ...base, recording })
    expect(parsed.recording).toBeDefined()
    expect(parsed.recording?.liveBlock).toBeUndefined()
    expect(parsed.recording?.bootDefer).toBeUndefined()
  })

  it("a malformed liveBlock drops the recording block, never the payload", () => {
    const parsed = telemetryPayloadSchema.parse({
      ...base,
      recording: { ...recording, liveBlock: { reason: 7, since: "yesterday" } },
    })
    expect(parsed.recording).toBeUndefined()
    // ...and the metrics — the reason this payload exists — are still here.
    expect(parsed.metrics.system.cpu_temp.value).toBe(61.2)
  })

  it("a missing recording block leaves the rest of the payload intact", () => {
    const parsed = telemetryPayloadSchema.parse(base)
    expect(parsed.recording).toBeUndefined()
    expect(parsed.metrics.system.cpu_temp.value).toBe(61.2)
  })
})
