import { describe, expect, it } from "vitest"
import type { Device } from "@xorgate/sdk"
import {
  computeConfigStatus,
  configStateExplanation,
  hasPending,
  NAMESPACE_TABS,
  parseReportedConfig,
  reportedAgentBuild,
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

// Cast to the SDK's reportedConfig slot: these fixtures deliberately include
// malformed shapes (parseReportedConfig's whole job), which the wire type
// cannot express.
function report(
  overrides: Record<string, unknown> = {}
): NonNullable<Device["reportedConfig"]> {
  return {
    v: 1,
    deviceId: "dev-1",
    ts: 1_800_000_000_000,
    rev: 5,
    origin: "cloud",
    effective: {},
    status: {},
    ...overrides,
  } as unknown as NonNullable<Device["reportedConfig"]>
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

describe("computeConfigStatus — cameraSensors (plans/support-other-camera-models)", () => {
  // The namespace exists only for a device whose agent acts on it: a real
  // device, the Rust agent, the `camera.sensors` capability. Any other agent
  // ignores the key and sends no status entry, and "present, level on rev, no
  // status entry" reads as applied. These pin that the badge never says
  // "Synced" over a setting the agent never looked at.
  const CAMERAS = { cameraSensors: { cameras: { cam0: { sensor: "imx708" } } } }
  const capable = { agent: { mode: "real", capabilities: ["camera.sensors"] } }
  const old = { agent: { mode: "real", capabilities: ["sms.read"] } }
  const rust = (overrides: Partial<Device> = {}) =>
    device({
      agent: "rust",
      simulated: false,
      configRev: 5,
      config: CAMERAS as unknown as Device["config"],
      ...overrides,
    } as Partial<Device>)

  it("reads Synced for a capable Rust device that is level and said nothing", () => {
    const status = computeConfigStatus(
      rust({ reportedConfig: report({ rev: 5, effective: capable }) })
    )
    expect(status.cameraSensors.state).toBe("applied")
  })

  // The agent's real status entries (phase-2/agent-report.md, "The agent-side
  // wire"): `adjusted` carries the sentence under `detail`, `rejected` under
  // `reason`. The page shows whichever is there, verbatim.
  const REBOOT_DETAIL =
    "written to the boot config — REBOOT REQUIRED to apply: cam0 imx708, cam1 none"
  const MULTI_PORT_REASON =
    'cam0: this agent build does not know the camera sensor "imx999" (it knows: imx290, imx219, ' +
    "imx708, imx335); update the agent or choose another sensor. config.txt is left as it is; " +
    'cam7: this device has no camera "cam7"; config.txt is left as it is; ' +
    "written to the boot config and waiting for a reboot: cam1 none"
  const withStatus = (entry: Record<string, unknown>, effective: Record<string, unknown> = {}) =>
    computeConfigStatus(
      rust({
        reportedConfig: report({
          rev: 5,
          effective: { ...capable, ...effective },
          status: { cameraSensors: entry },
        }),
      })
    )

  it("shows a pending reboot as adjusted, with the device's detail verbatim", () => {
    const status = withStatus(
      { state: "adjusted", at: 1, detail: REBOOT_DETAIL },
      { cameraSensors: { ...CAMERAS.cameraSensors, rebootRequired: true } }
    )
    expect(status.cameraSensors).toMatchObject({ state: "adjusted", detail: REBOOT_DETAIL })
    expect(configStateExplanation(status.cameraSensors)).toBe(REBOOT_DETAIL)
    // `adjusted` is on the card itself; it does not badge the tab.
    expect(tabAttentionCounts(status)).toEqual({})
  })

  it("shows a refusal as rejected, with the device's multi-port reason verbatim", () => {
    const status = withStatus({ state: "rejected", at: 1, reason: MULTI_PORT_REASON })
    expect(status.cameraSensors.state).toBe("rejected")
    expect(configStateExplanation(status.cameraSensors)).toBe(MULTI_PORT_REASON)
    expect(tabAttentionCounts(status)).toEqual({ media: 1 })
  })

  it("reads 'saved, not reconciled yet' as still applying, not as adjusted", () => {
    // The instant after a save: the device has the value and its reconciler
    // has not looked at config.txt yet. Nothing for an operator to act on.
    const entry = {
      state: "adjusted",
      at: 1,
      detail: "saved; the device has not reconciled its boot config yet",
    }
    const flagged = { cameraSensors: { ...CAMERAS.cameraSensors, reconciled: false } }
    const status = withStatus(entry, flagged)
    expect(status.cameraSensors.state).toBe("pending")
    expect(status.cameraSensors.detail).toBeUndefined()
    expect(configStateExplanation(status.cameraSensors)).toBe(
      "Saved and sent — waiting for the device to confirm it applied it."
    )
    // Either signal is enough: the flag without the sentence, the sentence
    // without the flag.
    expect(withStatus({ state: "adjusted", detail: "x" }, flagged).cameraSensors.state).toBe("pending")
    expect(withStatus(entry).cameraSensors.state).toBe("pending")
    // And it keeps the page polling for the report that follows.
    expect(hasPending(status)).toBe(true)
    // A device that went offline in that instant is waiting, not applying.
    const offline = computeConfigStatus(
      rust({
        status: "offline",
        reportedConfig: report({
          rev: 5,
          effective: { ...capable, ...flagged },
          status: { cameraSensors: entry },
        }),
      })
    )
    expect(offline.cameraSensors.state).toBe("queued")
  })

  it("never turns another verdict into 'applying' on the reconciled flag alone", () => {
    const flagged = { cameraSensors: { ...CAMERAS.cameraSensors, reconciled: false } }
    expect(withStatus({ state: "rejected", reason: "r" }, flagged).cameraSensors.state).toBe("rejected")
    expect(withStatus({ state: "applied" }, flagged).cameraSensors.state).toBe("applied")
    // Once reconciled, `adjusted` is adjusted.
    expect(
      withStatus(
        { state: "adjusted", detail: REBOOT_DETAIL },
        { cameraSensors: { ...CAMERAS.cameraSensors, rebootRequired: true } }
      ).cameraSensors.state
    ).toBe("adjusted")
  })

  it("shows whichever of detail and reason the device filled, for both states", () => {
    expect(configStateExplanation({ state: "adjusted", reason: "only a reason" })).toBe("only a reason")
    expect(configStateExplanation({ state: "rejected", detail: "only a detail" })).toBe("only a detail")
    // The rail's own field wins when both are there.
    expect(configStateExplanation({ state: "adjusted", detail: "d", reason: "r" })).toBe("d")
    expect(configStateExplanation({ state: "rejected", detail: "d", reason: "r" })).toBe("r")
  })

  describe("a cleared namespace", () => {
    // A revert leaves `status.<ns> = {"state":"applied"}` in every later
    // report: the device's acknowledgement that it dropped the value.
    const cleared = (
      ns: "cameraSensors" | "cameraMount",
      entry: Record<string, unknown>,
      effective: Record<string, unknown> = {}
    ) =>
      computeConfigStatus(
        rust({
          config: {},
          reportedConfig: report({
            rev: 5,
            effective: { ...capable, ...effective },
            status: { [ns]: entry },
          }),
        })
      )

    it.each(["cameraSensors", "cameraMount"] as const)(
      "shows no badge for %s when the cloud holds nothing and the device acknowledged the revert",
      (ns) => {
        const status = cleared(ns, { state: "applied", at: 1 })
        expect(status[ns].state).toBe("unset")
        expect(configStateExplanation(status[ns])).toBeNull()
        expect(tabAttentionCounts(status)).toEqual({})
      }
    )

    it("still says so when the device kept a value it was asked to drop", () => {
      const detail = "asked to revert to defaults, but the device is still holding a value"
      const status = cleared(
        "cameraSensors",
        { state: "adjusted", at: 1, detail },
        { cameraSensors: { ...CAMERAS.cameraSensors, rebootRequired: false } }
      )
      expect(status.cameraSensors).toMatchObject({ state: "adjusted", detail })
      expect(configStateExplanation(status.cameraSensors)).toBe(detail)
    })

    it("reads as 'Device differs' when the acknowledged device still reports a value", () => {
      const status = cleared(
        "cameraSensors",
        { state: "applied" },
        { cameraSensors: { ...CAMERAS.cameraSensors, rebootRequired: false } }
      )
      expect(status.cameraSensors.state).toBe("diverged")
    })

    it("keeps `applied` as Synced while the cloud does hold the namespace", () => {
      expect(withStatus({ state: "applied", at: 1 }).cameraSensors.state).toBe("applied")
      const mount = computeConfigStatus(
        rust({
          config: { cameraMount: { cameras: { cam0: { rotationDeg: 0 } } } },
          reportedConfig: report({
            rev: 5,
            effective: capable,
            status: { cameraMount: { state: "applied" } },
          }),
        })
      )
      expect(mount.cameraMount.state).toBe("applied")
    })

    it("is still Applying… while the revert itself is in flight", () => {
      const status = computeConfigStatus(
        rust({
          config: {},
          configRev: 6,
          status: "online",
          reportedConfig: report({
            rev: 5,
            effective: capable,
            status: { cameraSensors: { state: "applied" } },
          }),
        })
      )
      expect(status.cameraSensors.state).toBe("pending")
    })
  })

  it("is pending/queued for a capable device that is behind", () => {
    const behind = { rev: 4, effective: capable }
    expect(
      computeConfigStatus(rust({ status: "online", reportedConfig: report(behind) })).cameraSensors.state
    ).toBe("pending")
    expect(
      computeConfigStatus(rust({ status: "offline", reportedConfig: report(behind) })).cameraSensors.state
    ).toBe("queued")
  })

  it.each<[string, Partial<Device>]>([
    ["a JS device", { agent: "js", reportedConfig: report({ rev: 5, effective: capable }) }],
    ["an older Rust agent", { reportedConfig: report({ rev: 5, effective: old }) }],
    ["a Rust agent that reported no agent block", { reportedConfig: report({ rev: 5 }) }],
    ["a simulator", { simulated: true, reportedConfig: report({ rev: 5, effective: capable }) }],
  ])("never reads Synced for %s, even holding the key level on rev", (_who, overrides) => {
    const status = computeConfigStatus(rust(overrides))
    expect(status.cameraSensors.state).toBe("unset")
  })

  it("is not marked Applying… by an unrelated pending save on a device that cannot hold it", () => {
    const status = computeConfigStatus(
      rust({
        agent: "js",
        config: {},
        configRev: 6,
        status: "online",
        reportedConfig: report({ rev: 5 }),
      })
    )
    expect(status.cameraSensors.state).toBe("unset")
    expect(status.cameraMount.state).toBe("pending")
  })

  it("does not promise delivery ('No report yet') on a device that cannot hold it", () => {
    expect(computeConfigStatus(device({ agent: "js" } as Partial<Device>)).cameraSensors.state).toBe("unset")
    // A never-reported Rust device may hold the choice made at registration.
    expect(computeConfigStatus(rust()).cameraSensors.state).toBe("no-report")
  })

  it("never treats the reported-only effective.cameras block as a namespace value", () => {
    // The truth block sits beside the namespaces, not under the namespace key,
    // so an unmanaged device is not "Device differs".
    const status = computeConfigStatus(
      rust({
        config: {},
        reportedConfig: report({
          rev: 5,
          effective: { ...capable, cameras: { cam0: { verdict: "ok" } } },
        }),
      })
    )
    expect(status.cameraSensors.state).toBe("unset")
  })

  it("diverges when a capable device holds a declaration the cloud does not", () => {
    const status = computeConfigStatus(
      rust({
        config: {},
        reportedConfig: report({ rev: 5, effective: { ...capable, ...CAMERAS } }),
      })
    )
    expect(status.cameraSensors.state).toBe("diverged")
  })

  it("is edited on the Media tab", () => {
    expect(NAMESPACE_TABS.cameraSensors).toEqual(["media"])
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
      media: 2, // recording + cameraMount
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

describe("reportedAgentBuild", () => {
  const build = {
    version: "a1b2c3d",
    channel: "dev",
    builtAt: "2026-08-10T14:00:00Z",
    packageVersion: "0.2.0",
  }

  it("reads the build the device reported", () => {
    expect(
      reportedAgentBuild(
        device({ reportedConfig: report({ effective: { agent: { mode: "real", build } } }) })
      )
    ).toEqual(build)
  })

  it("is null for a device that reports no build — an agent older than the manifest", () => {
    expect(reportedAgentBuild(null)).toBeNull()
    expect(reportedAgentBuild(device())).toBeNull()
    expect(reportedAgentBuild(device({ reportedConfig: report() }))).toBeNull()
    expect(
      reportedAgentBuild(
        device({ reportedConfig: report({ effective: { agent: { mode: "real" } } }) })
      )
    ).toBeNull()
  })

  it("survives a malformed report rather than throwing — `effective` is device-authored", () => {
    const cases = [
      { agent: "real" },
      { agent: { mode: "real", build: "a1b2c3d" } },
      { agent: { mode: "real", build: ["a1b2c3d"] } },
      { agent: { mode: "real", build: { version: 42 } } },
      { agent: { mode: "real", build: { version: "  " } } },
    ]
    for (const effective of cases) {
      expect(reportedAgentBuild(device({ reportedConfig: report({ effective }) }))).toBeNull()
    }
  })

  it("keeps the version but degrades the optional fields it cannot trust", () => {
    expect(
      reportedAgentBuild(
        device({
          reportedConfig: report({
            effective: { agent: { build: { version: " a1b2c3d ", channel: 7, builtAt: null } } },
          }),
        })
      )
    ).toEqual({
      version: "a1b2c3d",
      channel: null,
      builtAt: null,
      packageVersion: null,
    })
  })
})
