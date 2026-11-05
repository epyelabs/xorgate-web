import { describe, expect, it } from "vitest"
import { restoreBindings, uploadKeyName } from "./simulator-restore"

const sources = [
  { id: "vid", catalogType: "source.video" },
  { id: "vid2", catalogType: "source.video" },
  { id: "tel", catalogType: "source.telemetry" },
  { id: "tel2", catalogType: "source.telemetry" },
]

describe("restoreBindings", () => {
  it("rebuilds file, device-telemetry and webcam bindings", () => {
    const r = restoreBindings(
      {
        vid: { kind: "video_file", uploadKey: "simulations/uploads/o/t/abc/clip.mp4" },
        vid2: { kind: "webcam", maxDurationSeconds: 30 },
        tel: { kind: "telemetry_csv", uploadKey: "simulations/uploads/o/t/def/gps.csv" },
        tel2: {
          kind: "device_telemetry",
          deviceId: "22c38bf0-aaaa-bbbb-cccc-000000000000",
          window: { from: "2026-11-05T10:00:00.000Z", to: "2026-11-05T10:05:00.000Z" },
          metrics: ["speed"],
        },
      },
      sources,
      { "22c38bf0-aaaa-bbbb-cccc-000000000000": "Bench Pi" }
    )
    expect(r.unrestored).toEqual([])
    expect(r.skipped).toEqual([])
    expect(r.bindings).toEqual({
      vid: {
        kind: "uploaded-file",
        media: "video",
        uploadKey: "simulations/uploads/o/t/abc/clip.mp4",
        name: "clip.mp4",
      },
      vid2: { kind: "video-webcam", name: "Webcam" },
      tel: {
        kind: "uploaded-file",
        media: "csv",
        uploadKey: "simulations/uploads/o/t/def/gps.csv",
        name: "gps.csv",
      },
      tel2: {
        kind: "device-telemetry",
        deviceId: "22c38bf0-aaaa-bbbb-cccc-000000000000",
        deviceName: "Bench Pi",
        window: {
          mode: "range",
          from: "2026-11-05T10:00:00.000Z",
          to: "2026-11-05T10:05:00.000Z",
        },
      },
    })
  })

  it("names an unknown device by its id prefix", () => {
    const r = restoreBindings(
      {
        tel: {
          kind: "device_telemetry",
          deviceId: "7f2d32e6-1111-2222-3333-444444444444",
          window: { from: "a", to: "b" },
        },
      },
      sources
    )
    expect(r.bindings.tel).toMatchObject({ deviceName: "Device 7f2d32e6" })
  })

  it("leaves sessions unbound, and flags kind mismatches and junk", () => {
    const r = restoreBindings(
      {
        vid: { kind: "session", sessionId: "s1" },
        tel: { kind: "video_file", uploadKey: "k/clip.mp4" },
        vid2: { kind: "telemetry_csv", uploadKey: "k/gps.csv" },
        tel2: { kind: "recording", recordingId: "r1" },
      },
      sources
    )
    expect(r.bindings).toEqual({})
    expect(r.unrestored).toEqual([
      { nodeId: "vid", kind: "session", reason: "needs-fetch" },
      { nodeId: "tel", kind: "video_file", reason: "kind-mismatch" },
      { nodeId: "vid2", kind: "telemetry_csv", reason: "kind-mismatch" },
      { nodeId: "tel2", kind: "recording", reason: "unknown" },
    ])
  })

  it("skips nodes that are no longer in the graph", () => {
    const r = restoreBindings(
      { gone: { kind: "webcam" }, vid: { kind: "webcam" } },
      sources
    )
    expect(r.skipped).toEqual(["gone"])
    expect(Object.keys(r.bindings)).toEqual(["vid"])
  })

  it("tolerates a missing or malformed snapshot", () => {
    for (const snap of [null, undefined, "x", [], 3]) {
      expect(restoreBindings(snap, sources)).toEqual({
        bindings: {},
        unrestored: [],
        skipped: [],
      })
    }
  })
})

describe("uploadKeyName", () => {
  it("takes the last path segment", () => {
    expect(uploadKeyName("a/b/c.mp4")).toBe("c.mp4")
    expect(uploadKeyName("c.mp4")).toBe("c.mp4")
    expect(uploadKeyName("a/b/")).toBe("b")
  })
})
