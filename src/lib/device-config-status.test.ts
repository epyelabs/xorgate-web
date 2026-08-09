import { describe, expect, it } from "vitest"
import type { Device } from "./api"
import {
  computeConfigStatus,
  configStateExplanation,
  hasPending,
  parseReportedConfig,
  reportedAgentMode,
  tabAttentionCounts,
} from "./device-config-status"

// Only the fields the status computation reads; the rest of Device is
// irrelevant here and casting keeps the fixtures readable.
function device(overrides: Partial<Device> = {}): Device {
  return {
    id: "dev-1",
    status: "online",
    config: {},
    configRev: 0,
    reportedConfig: null,
    reportedAt: null,
    ...overrides,
  } as Device
}

function report(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    deviceId: "dev-1",
    ts: 1_800_000_000_000,
    rev: 5,
    origin: "cloud",
    effective: {},
    status: {},
    ...overrides,
  }
}

describe("parseReportedConfig", () => {
  it("returns null for a device that has never reported", () => {
    expect(parseReportedConfig(null)).toBeNull()
    expect(parseReportedConfig(undefined)).toBeNull()
  })

  it("drops status entries with a state this build does not know", () => {
    // The report is device-authored JSON arriving through an MQTT rule, not
    // through our own API — an agent newer than this build must not be able to
    // throw inside a render.
    const parsed = parseReportedConfig(
      report({
        status: {
          recording: { state: "applied", at: 1 },
          timeSync: { state: "levitating" },
          imuMount: "not an object",
        },
      })
    )
    expect(Object.keys(parsed!.status)).toEqual(["recording"])
  })

  it("normalizes a missing or nonsense rev to 0 (never received one)", () => {
    expect(parseReportedConfig(report({ rev: undefined }))!.rev).toBe(0)
    expect(parseReportedConfig(report({ rev: "9" }))!.rev).toBe(0)
    expect(parseReportedConfig(report({ rev: -3 }))!.rev).toBe(0)
  })

  it("tolerates a missing effective/status half", () => {
    const parsed = parseReportedConfig(report({ effective: undefined, status: undefined }))
    expect(parsed).toMatchObject({ effective: {}, status: {} })
  })
})

describe("computeConfigStatus", () => {
  it("reads no-report for a device that has never reported", () => {
    // The pre-Phase-3 degradation case: an old agent never publishes, and the
    // page must still say something honest rather than break.
    const status = computeConfigStatus(device({ configRev: 3 }))
    expect(status.recording.state).toBe("no-report")
    expect(status.gnssAntBias.state).toBe("no-report")
    expect(configStateExplanation(status.recording)).toMatch(/delivered when it next connects/)
  })

  it("reads no-report before the device object has loaded", () => {
    expect(computeConfigStatus(null).timeSync.state).toBe("no-report")
  })

  it("is pending while an online device is behind the stored rev", () => {
    const status = computeConfigStatus(
      device({
        configRev: 6,
        status: "online",
        reportedConfig: report({ rev: 5, status: { recording: { state: "applied" } } }),
      })
    )
    // The report describes rev 5 and says "applied" — but rev 6 is what the
    // operator just saved, and claiming that is applied is the exact lie this
    // plane exists to stop telling.
    expect(status.recording.state).toBe("pending")
    expect(hasPending(status)).toBe(true)
  })

  it("is queued (not pending) while the device is offline", () => {
    const status = computeConfigStatus(
      device({ configRev: 6, status: "offline", reportedConfig: report({ rev: 5 }) })
    )
    expect(status.recording.state).toBe("queued")
    expect(hasPending(status)).toBe(false)
    expect(configStateExplanation(status.recording)).toMatch(/when it reconnects/)
  })

  it("passes applied/adjusted/rejected straight through once the device is level", () => {
    const status = computeConfigStatus(
      device({
        configRev: 5,
        config: {
          recording: {},
          imuMount: { enabled: false, rollDeg: 0, pitchDeg: 0, yawDeg: 0 },
          gnssAntBias: true,
        },
        reportedConfig: report({
          rev: 5,
          effective: { recording: { telemetry: { rateHz: 20 } } },
          status: {
            recording: { state: "adjusted", at: 7, detail: "clamped" },
            imuMount: { state: "rejected", reason: "rollDeg not finite" },
            gnssAntBias: { state: "applied" },
          },
        }),
      })
    )
    expect(status.recording).toMatchObject({
      state: "adjusted",
      detail: "clamped",
      at: 7,
      effective: { telemetry: { rateHz: 20 } },
    })
    expect(status.imuMount).toMatchObject({ state: "rejected", reason: "rollDeg not finite" })
    expect(status.gnssAntBias.state).toBe("applied")
    expect(configStateExplanation(status.gnssAntBias)).toBeNull()
  })

  it("reads unset for a namespace neither side manages", () => {
    const status = computeConfigStatus(
      device({ configRev: 5, config: {}, reportedConfig: report({ rev: 5 }) })
    )
    expect(status.timeSync.state).toBe("unset")
    // An unmanaged namespace has nothing to explain and nothing to badge.
    expect(configStateExplanation(status.timeSync)).toBeNull()
  })

  it("reads applied when the cloud manages a namespace the report is silent on", () => {
    const status = computeConfigStatus(
      device({ configRev: 5, config: { timeSync: {} }, reportedConfig: report({ rev: 5 }) })
    )
    expect(status.timeSync.state).toBe("applied")
  })

  it("treats an explicitly cleared namespace as unmanaged, not applied", () => {
    // Part (b) stores a revert as a cleared marker rather than deleting the
    // key; `ns in config` would read that as "the cloud manages this".
    const status = computeConfigStatus(
      device({
        configRev: 5,
        // Cast: the parsed `Device["config"]` type does not admit null (the API
        // strips the marker on read), so this asserts the runtime guard holds
        // for a document that reaches the browser unstripped anyway.
        config: { timeSync: null } as unknown as Device["config"],
        reportedConfig: report({ rev: 5 }),
      })
    )
    expect(status.timeSync.state).toBe("unset")
  })
})

// settings_sync_hardening, finding 2. The cloud managing nothing for a
// namespace says nothing about what the device is holding — before this, the
// page showed defaults with no badge while the device ran something else.
describe("computeConfigStatus — divergence from device defaults", () => {
  const level = (config: Record<string, unknown>, effective: Record<string, unknown>) =>
    computeConfigStatus(
      device({ configRev: 5, config, reportedConfig: report({ rev: 5, effective }) })
    )

  it("stays unset when the cloud manages nothing and the device is on defaults", () => {
    // imuMount's shipped default, spelled out exactly.
    const status = level({}, { imuMount: { enabled: false, rollDeg: 0, pitchDeg: 0, yawDeg: 0 } })
    expect(status.imuMount.state).toBe("unset")
    expect(configStateExplanation(status.imuMount)).toBeNull()
  })

  it("stays unset when the device holds nothing at all", () => {
    // Absent-means-defaults, the convention both sides share.
    expect(level({}, {}).imuMount.state).toBe("unset")
  })

  it("diverges when the cloud manages nothing and the device holds another value", () => {
    // B11b live: `PATCH {"imuMount": null}` empties the cloud while
    // settings.json keeps 90/0/90, and the device — never sent the namespace —
    // reports no verdict for it either.
    const status = level({}, { imuMount: { enabled: true, rollDeg: 90, pitchDeg: 0, yawDeg: 90 } })
    expect(status.imuMount.state).toBe("diverged")
    expect(status.imuMount.effective).toEqual({
      enabled: true,
      rollDeg: 90,
      pitchDeg: 0,
      yawDeg: 90,
    })
    expect(configStateExplanation(status.imuMount)).toMatch(/running a different value/)
  })

  it("compares structurally, not by serialization", () => {
    // The device re-serializes settings.json in its own key order;
    // JSON.stringify equality would call this a divergence.
    const status = level({}, { imuMount: { yawDeg: 0, pitchDeg: 0, rollDeg: 0, enabled: false } })
    expect(status.imuMount.state).toBe("unset")
  })

  it("resolves a partially-held namespace over the defaults before comparing", () => {
    // `effective` is the RAW stored namespace, not a resolved one. Every key
    // the device holds matches the default, so nothing has moved — badging
    // this would be a false alarm on any device with a partial settings.json.
    const status = level({}, { timeSync: { offlineSources: true } })
    expect(status.timeSync.state).toBe("unset")
  })

  it("diverges on a single moved key deep inside a partially-held namespace", () => {
    const status = level({}, { recording: { telemetry: { enabled: true } } })
    expect(status.recording.state).toBe("diverged")
  })

  it("diverges on a key the defaults do not carry", () => {
    // `cameras` defaults to `{}` — an explicit per-camera choice is a value
    // the device is holding that this page is not showing.
    const status = level({}, { recording: { video: { cameras: { cam1: false } } } })
    expect(status.recording.state).toBe("diverged")
  })

  it("never overrides a verdict the device actually gave", () => {
    // Divergence is only ever computed for the silence case; anything the
    // device reported comes straight through, as it always has.
    const status = computeConfigStatus(
      device({
        configRev: 5,
        config: {},
        reportedConfig: report({
          rev: 5,
          effective: { imuMount: { enabled: true, rollDeg: 90, pitchDeg: 0, yawDeg: 90 } },
          status: { imuMount: { state: "applied" } },
        }),
      })
    )
    expect(status.imuMount.state).toBe("applied")
  })

  it("never outranks pending — an unreached revision still wins", () => {
    const status = computeConfigStatus(
      device({
        configRev: 6,
        status: "online",
        config: {},
        reportedConfig: report({
          rev: 5,
          effective: { imuMount: { enabled: true, rollDeg: 90, pitchDeg: 0, yawDeg: 90 } },
        }),
      })
    )
    expect(status.imuMount.state).toBe("pending")
  })

  it("badges the tabs that edit a diverged namespace", () => {
    const status = level({}, { imuMount: { enabled: true, rollDeg: 90, pitchDeg: 0, yawDeg: 90 } })
    // Unlike `adjusted`, the card itself shows the defaults and looks fine —
    // without a count there is no reason to open the tab.
    expect(tabAttentionCounts(status)).toEqual({ telemetry: 1 })
  })
})

describe("tabAttentionCounts", () => {
  it("flags every tab that edits part of a troubled namespace", () => {
    // `recording` spans Telemetry/Media/Power/System — the document namespaces
    // are wire names, deliberately not the UI grouping.
    const status = computeConfigStatus(
      device({ configRev: 6, status: "online", reportedConfig: report({ rev: 5 }) })
    )
    expect(tabAttentionCounts(status)).toEqual({
      connectivity: 3, // gnssAntBias + lteRecovery + cellular
      telemetry: 2, // imuMount + recording
      media: 1,
      power: 1,
      system: 2, // recording + timeSync
    })
  })

  it("counts nothing when everything is applied or unset", () => {
    const status = computeConfigStatus(
      device({
        configRev: 5,
        config: { recording: {} },
        reportedConfig: report({ rev: 5, status: { recording: { state: "applied" } } }),
      })
    )
    expect(tabAttentionCounts(status)).toEqual({})
  })

  it("does not badge an adjusted namespace — it is visible on the card itself", () => {
    const status = computeConfigStatus(
      device({
        configRev: 5,
        config: { timeSync: {} },
        reportedConfig: report({ rev: 5, status: { timeSync: { state: "adjusted" } } }),
      })
    )
    expect(tabAttentionCounts(status)).toEqual({})
  })
})

describe("reportedAgentMode", () => {
  it("reads the run mode the device reported", () => {
    expect(
      reportedAgentMode(
        device({ reportedConfig: report({ effective: { agent: { mode: "sim" } } }) })
      )
    ).toBe("sim")
  })

  it("is null when the device has never reported, or reported no mode", () => {
    expect(reportedAgentMode(null)).toBeNull()
    expect(reportedAgentMode(device())).toBeNull()
    expect(reportedAgentMode(device({ reportedConfig: report() }))).toBeNull()
    expect(
      reportedAgentMode(device({ reportedConfig: report({ effective: { agent: { mode: 7 } } }) }))
    ).toBeNull()
  })

  it("never becomes a namespace verdict — the cloud cannot set it", () => {
    const status = computeConfigStatus(
      device({
        configRev: 5,
        reportedConfig: report({ rev: 5, effective: { agent: { mode: "real" } } }),
      })
    )
    expect(status).not.toHaveProperty("agent")
  })
})
