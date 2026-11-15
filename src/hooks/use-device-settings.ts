import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  isXorgateError,
  type CameraMountConfig,
  type SimulationConfig,
  type CellularConfig,
  type Device,
  type DeviceConfigPatch,
  type DeviceUiPrefsPatch,
  type LteRecoveryConfig,
  type ObdConfig,
  type RecordingConfig,
  type TimeSyncConfig,
} from "@xorgate/sdk"
import {
  xg,
  xgMessage,
  type ActiveStreamsViewType,
  type ImuMount,
  type ImuView,
} from "@/lib/xorgate"
import {
  buildRecordingConfig,
  resolveRecording,
  type ResolvedRecording,
} from "@/lib/device-config-defaults"
import {
  computeConfigStatus,
  hasPending,
  reportedAgentBuild,
  type DeviceConfigStatus,
} from "@/lib/device-config-status"
// Moved to lib/ so device-config-status.ts can use the same one — a lib
// importing this hook (which imports that lib) would be a cycle. Re-exported
// because the change-detection helper is part of this module's surface.
import { deepEqual } from "@/lib/deep-equal"
export { deepEqual }
import { useQueryClient } from "@tanstack/react-query"
import { getCachedDevice } from "@/queries/devices"
import { qk } from "@/queries/keys"
import { useTenant } from "@/queries/tenant"
import { updaterUnit, type ReportedAgentKind } from "@/lib/agent-channel"
import { useBreadcrumbStore } from "@/store/breadcrumb"

// The one save layer for the device Settings tab. Replaces the seven
// near-identical commit functions the page used to carry (name/status,
// gnssAntBias, lteRecovery, timeSync, viewType, imuMount, imuView, recording),
// each with its own equality test and its own copy of the optimistic-apply /
// rollback dance.
//
// Model: the parsed device object IS the form state. A control calls
// `commit(key, patch)`; the patch is applied optimistically to that object,
// then PUT. Success re-seeds the touched fields from the response; failure
// rolls the whole object back to the last server-confirmed value and toasts.
// There is no hand-maintained baseline copy to forget to update.
//
// Phase 2 swapped the transport underneath without touching a single tab: a
// patch is still keyed by FORM FIELD (`recordingConfig`, `imuView`, `name`),
// and this hook routes each key to the endpoint that owns it —
// `devices.patchConfig()` for anything delivered to the device,
// `devices.patchUiPrefs()` for cloud-only prefs, `devices.update()` for
// metadata. The SDK's Device carries no top-level duplicates, so reads and
// optimistic writes both land on `device.config` / `device.uiPrefs`; the
// mapping tables below are what tie a form key to its namespace.

/**
 * Patch keys are device fields, not namespaces — that indirection is what let
 * the transport change land in this file alone.
 */
export interface DeviceSettingsPatch {
  name?: string | null
  gnssAntBias?: boolean
  imuMount?: ImuMount | null
  recordingConfig?: RecordingConfig | null
  lteRecoveryConfig?: LteRecoveryConfig | null
  timeSyncConfig?: TimeSyncConfig | null
  /**
   * `cellular` has NO legacy device column (it postdates the consolidation) —
   * this key exists only to route through CONFIG_FIELDS; read the value from
   * `device.config.cellular`, never from a top-level field.
   */
  cellularConfig?: CellularConfig | null
  /**
   * Camera mounting rotation. Like `cellular` it has NO legacy device column —
   * this key exists only to route through CONFIG_FIELDS; read the value from
   * `device.config.cameraMount`, never from a top-level field.
   */
  cameraMountConfig?: CameraMountConfig | null
  /**
   * Simulated devices only. Routed like `cameraMount` (no legacy column); the
   * Settings card is read-only and the scenario is switched from the reboot
   * dialog, so nothing commits this today. It is here so the namespace has a
   * field like every other one.
   */
  simulationConfig?: SimulationConfig | null
  /**
   * OBD-II adapter (plans/obd2-bluetooth-integration). Routed like
   * `cameraMount` (no legacy column); read it from `device.config.obd`. The
   * API refuses it for a model without `peripherals.obd`, which the Peripherals
   * tab gates on before offering a control.
   */
  obdConfig?: ObdConfig | null
  activeStreamsViewType?: ActiveStreamsViewType
  imuView?: ImuView | null
}

/**
 * How often to re-read the device while a namespace is pending, and for how
 * long. 5 s comfortably beats the device's own report latency (it publishes
 * within ~2 s of applying), and 2 minutes is far longer than any healthy
 * round trip — past that the device is not answering and polling is noise.
 */
const REPORT_POLL_MS = 5000
/** 6 minutes at REPORT_POLL_MS — a device update is download + npm ci + restart. */
const AGENT_UPDATE_POLL_TICKS = 72
const REPORT_POLL_MAX_TICKS = 24

/** Device field -> config namespace (`PATCH /devices/{id}/config`). */
const CONFIG_FIELDS = {
  gnssAntBias: "gnssAntBias",
  imuMount: "imuMount",
  recordingConfig: "recording",
  lteRecoveryConfig: "lteRecovery",
  timeSyncConfig: "timeSync",
  cellularConfig: "cellular",
  cameraMountConfig: "cameraMount",
  simulationConfig: "simulation",
  obdConfig: "obd",
} as const

/** Device field -> ui-pref key (`PATCH /devices/{id}/ui-prefs`). */
const UI_PREF_FIELDS = {
  activeStreamsViewType: "activeStreamsViewType",
  imuView: "imuView",
} as const

type ConfigField = keyof typeof CONFIG_FIELDS
type UiPrefField = keyof typeof UI_PREF_FIELDS

const isConfigField = (k: string): k is ConfigField => k in CONFIG_FIELDS
const isUiPrefField = (k: string): k is UiPrefField => k in UI_PREF_FIELDS

export interface DeviceSettings {
  /** Optimistic device object — the source of truth for every control. */
  device: Device | null
  /** Recording namespace resolved over the device defaults. */
  recording: ResolvedRecording
  /**
   * Desired-vs-reported verdict per config namespace (Phase 3). Refreshed by
   * the poll below while anything is pending, so a control settles from
   * "Applying…" to "Synced" without the operator reloading the page.
   */
  configStatus: DeviceConfigStatus
  error: string | null
  notFound: boolean
  /**
   * True while THAT control's save is in flight. Deliberately per-key: the old
   * page disabled all ~24 controls behind one boolean and dropped clicks that
   * arrived during any save (`if (saving) return`).
   */
  isPending: (key: string) => boolean
  /** Optimistically apply + save. Fire-and-forget; errors surface as a toast. */
  commit: (key: string, patch: DeviceSettingsPatch) => void
  /** Same, for the `recording` namespace — always PUT whole (see design §3). */
  commitRecording: (key: string, mutate: (r: ResolvedRecording) => void) => void
  /**
   * Ask the device to re-probe and re-report NOW (Phase 2 §4d), then fold the
   * fresh report into the page. True while the round trip is in flight.
   */
  refreshReport: () => void
  refreshing: boolean
  /**
   * Re-read the device row every few seconds until `done` says the report
   * carries what the caller is waiting for, or `maxTicks` polls have passed.
   * Resolves to whether `done` was met. Each fetch is folded into the page
   * through the same server-owned-fields merge every other poller here uses,
   * so a card waiting on (say) a scan result reads it off `device` like any
   * other reported value instead of keeping a second copy of the row.
   */
  pollReport: (done: (device: Device) => boolean, maxTicks?: number) => Promise<boolean>
  /**
   * Ask the device to install the latest published agent build, then poll the
   * row until its reported build changes (or it comes back on the same one).
   * True for the whole round trip, which can run to several minutes.
   */
  updateAgent: (
    expectedVersion?: string | null,
    agent?: ReportedAgentKind | null
  ) => void
  updatingAgent: boolean
}

export function useDeviceSettings(id: string): DeviceSettings {
  // Seed from the query cache so the tab paints the row the layout already
  // holds instead of a skeleton; the fetch below still runs and replaces it
  // with the authoritative answer (the cached copy may lag a recent save).
  const queryClient = useQueryClient()
  const { orgId, wsId } = useTenant()
  const [seed] = useState<Device | null>(
    () => getCachedDevice(queryClient, orgId, wsId, id) ?? null
  )
  const [device, setDevice] = useState<Device | null>(seed)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  // key -> in-flight count (a key can be queued more than once).
  const [pending, setPending] = useState<Record<string, number>>({})

  // What the UI shows (state + optimistic edits) and what a failed save rolls
  // back to. Refs because commits are built from the latest value, not from
  // whatever this render closed over.
  const optimisticRef = useRef<Device | null>(seed)
  const serverRef = useRef<Device | null>(seed)
  // Saves run one at a time, in click order: two controls PUT the same row, so
  // overlapping requests would race on last-write-wins. Queuing keeps every
  // click (nothing is dropped) while keeping the writes ordered.
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  // Bumped when a save fails: still-queued saves are abandoned rather than
  // written on top of a form the user just saw roll back.
  const generationRef = useRef(0)

  const applyDevice = useCallback((next: Device) => {
    optimisticRef.current = next
    setDevice(next)
  }, [])

  // Server-confirmed rows are written back into the query cache, so the
  // layout header (name, status badge, model) shows a save in the same frame
  // instead of at its next poll. Only rows the SERVER answered with go in —
  // never the optimistic form state.
  const writeThrough = useCallback(
    (row: Device) => {
      queryClient.setQueryData(qk.device(orgId, wsId, id), row)
    },
    [queryClient, orgId, wsId, id]
  )

  const bumpPending = useCallback((key: string, delta: number) => {
    setPending((prev) => {
      const count = (prev[key] ?? 0) + delta
      if (count > 0) return { ...prev, [key]: count }
      if (!(key in prev)) return prev
      const rest = { ...prev }
      delete rest[key]
      return rest
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const fetched = await xg().devices.get(id)
        if (cancelled) return
        serverRef.current = fetched
        writeThrough(fetched)
        applyDevice(fetched)
      } catch (err) {
        if (isXorgateError(err) && err.status === 404) {
          if (!cancelled) setNotFound(true)
          return
        }
        const message = xgMessage(err)
        if (!cancelled) setError(message)
        toast.error(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, applyDevice, writeThrough])

  const configStatus = computeConfigStatus(device)
  const pendingCount = Object.keys(pending).length

  // Reported state arrives out of band (device -> MQTT -> mirror Lambda -> DB),
  // so there is nothing to await after a save: poll while a namespace is
  // pending and stop as soon as it settles. Only ONLINE devices produce a
  // `pending` state — an offline one reads `queued` and never spins here.
  useEffect(() => {
    if (!hasPending(configStatus)) return
    // A device that is online but never reports (a pre-Phase-3 agent) would
    // otherwise poll for as long as the page is open. Cap it; the operator can
    // reload, and the tab badge keeps saying "Applying…" honestly either way.
    let ticksLeft = REPORT_POLL_MAX_TICKS
    let cancelled = false
    const timer = setInterval(() => {
      if (ticksLeft-- <= 0) {
        clearInterval(timer)
        return
      }
      // Never race a save: an in-flight write is about to return a fresher row
      // than this fetch would, and re-seeding from a stale read mid-queue is
      // how optimistic edits get clobbered.
      if (pendingCount > 0) return
      void (async () => {
        try {
          const fetched = await xg().devices.get(id)
          if (cancelled) return
          serverRef.current = fetched
          writeThrough(fetched)
          // Merge only the server-owned fields. The rest of the object is the
          // live form state and must not be reset under the operator's hands.
          applyDevice({
            ...(optimisticRef.current ?? fetched),
            status: fetched.status,
            lastSeenAt: fetched.lastSeenAt,
            configRev: fetched.configRev,
            reportedConfig: fetched.reportedConfig,
            reportedAt: fetched.reportedAt,
          })
        } catch {
          // A failed background refresh is not worth a toast — the next tick
          // (or a reload) retries, and nothing the operator did has failed.
        }
      })()
    }, REPORT_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // `configStatus` is recomputed every render; keying the effect on the
    // boolean keeps this to one interval per pending episode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hasPending(configStatus), pendingCount, applyDevice, writeThrough])

  const commit = useCallback(
    (key: string, patch: DeviceSettingsPatch) => {
      const current = optimisticRef.current
      if (current === null) return

      // Drop undefined entries so a spread can never blank a stored field.
      const updates = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined)
      ) as DeviceSettingsPatch
      const keys = Object.keys(updates) as (keyof DeviceSettingsPatch)[]
      if (keys.length === 0) return

      // What the device object currently holds for a patch key. The legacy
      // top-level duplicates are gone (the SDK's Device carries config/uiPrefs
      // only), so each key resolves into the document that owns it.
      const readField = (device: Device, field: keyof DeviceSettingsPatch) => {
        if (isConfigField(field)) return device.config[CONFIG_FIELDS[field]] ?? null
        if (isUiPrefField(field)) return device.uiPrefs[UI_PREF_FIELDS[field]] ?? null
        return device.name
      }

      // Nothing actually changed (an incidental blur, a re-select of the value
      // already stored) — don't hit the API.
      if (keys.every((k) => deepEqual(readField(current, k), updates[k])))
        return

      // Optimistic apply, straight into the consolidated documents.
      const next = { ...current }
      next.config = { ...current.config }
      next.uiPrefs = { ...current.uiPrefs }
      for (const [field, value] of Object.entries(updates)) {
        if (isConfigField(field)) {
          const ns = CONFIG_FIELDS[field]
          if (value === null) delete next.config[ns]
          else (next.config as Record<string, unknown>)[ns] = value
        } else if (isUiPrefField(field)) {
          const pref = UI_PREF_FIELDS[field]
          if (value === null) delete next.uiPrefs[pref]
          else (next.uiPrefs as Record<string, unknown>)[pref] = value
        } else if (field === "name") {
          next.name = value as string | null
        }
      }

      applyDevice(next)
      const generation = generationRef.current
      bumpPending(key, 1)
      queueRef.current = queueRef.current.then(async () => {
        if (generation !== generationRef.current) {
          // A save failed while this one waited; the form has already been
          // rolled back, so writing this would resurrect a discarded edit.
          bumpPending(key, -1)
          return
        }
        try {
          // Split the patch by owning endpoint. In practice a control touches
          // one key, but a mixed patch stays correct: the requests run in
          // order and the last response is the freshest device row.
          const configPatch: DeviceConfigPatch = {}
          const uiPrefsPatch: DeviceUiPrefsPatch = {}
          const metaPatch: { name?: string | null } = {}
          for (const [field, value] of Object.entries(updates)) {
            if (isConfigField(field)) {
              // `null` means "revert this namespace to device defaults".
              ;(configPatch as Record<string, unknown>)[CONFIG_FIELDS[field]] = value
            } else if (isUiPrefField(field)) {
              ;(uiPrefsPatch as Record<string, unknown>)[UI_PREF_FIELDS[field]] = value
            } else {
              ;(metaPatch as Record<string, unknown>)[field] = value
            }
          }

          let updated: Device | null = null
          if (Object.keys(metaPatch).length > 0) {
            updated = await xg().devices.update(id, metaPatch)
          }
          if (Object.keys(configPatch).length > 0) {
            // patchConfig, deliberately: every control here builds its
            // namespace WHOLE (commitRecording resolves over defaults first),
            // which is exactly the endpoint's replace semantics. mergeConfig
            // exists for callers sending fragments; this hook never does.
            updated = await xg().devices.patchConfig(id, configPatch)
          }
          if (Object.keys(uiPrefsPatch).length > 0) {
            updated = await xg().devices.patchUiPrefs(id, uiPrefsPatch)
          }
          if (updated === null) throw new Error("Nothing to save")
          serverRef.current = updated
          writeThrough(updated)
          // Re-seed only what this save owns: later queued edits are already
          // optimistically applied and must survive. config/uiPrefs come back
          // wholesale below; `name` is the one field re-seeded individually.
          const merged = { ...(optimisticRef.current ?? updated) }
          if (keys.includes("name")) merged.name = updated.name
          merged.status = updated.status
          merged.lastSeenAt = updated.lastSeenAt
          merged.updatedAt = updated.updatedAt
          // The consolidated document comes back wholesale: it is the server's
          // view of every namespace, and re-seeding it keeps it from drifting
          // behind the dual-written top-level fields the tabs read. A still
          // queued edit re-seeds it again when it lands.
          merged.config = updated.config
          merged.configRev = updated.configRev
          merged.configUpdatedAt = updated.configUpdatedAt
          merged.uiPrefs = updated.uiPrefs
          applyDevice(merged)
          if (keys.includes("name")) {
            // The layout header refreshes on next navigation; the breadcrumb
            // store updates live.
            useBreadcrumbStore
              .getState()
              .setDeviceName(updated.name ?? updated.serial)
          }
          toast.success("Settings saved")
        } catch (err) {
          generationRef.current += 1
          toast.error((err as Error).message)
          // Roll the whole form back to the last server-confirmed values so
          // what is on screen is what the server actually holds.
          if (serverRef.current) applyDevice(serverRef.current)
        } finally {
          bumpPending(key, -1)
        }
      })
    },
    [id, applyDevice, bumpPending, writeThrough]
  )

  const commitRecording = useCallback(
    (key: string, mutate: (r: ResolvedRecording) => void) => {
      const current = optimisticRef.current
      if (current === null) return
      const stored = current.config.recording ?? null
      const next = resolveRecording(stored)
      mutate(next)
      const nextCfg = buildRecordingConfig(next)
      // A no-op mutation on an already-complete namespace: skip. When the
      // device has never been configured (stored === null) the first touch
      // always writes, materializing the whole namespace.
      if (
        stored !== null &&
        deepEqual(nextCfg, buildRecordingConfig(resolveRecording(stored)))
      ) {
        return
      }
      commit(key, { recordingConfig: nextCfg })
    },
    [commit]
  )

  const isPending = useCallback(
    (key: string) => (pending[key] ?? 0) > 0,
    [pending]
  )

  // On-demand device refresh (Phase 2 §4d). The command is fire-and-forget on
  // the wire, so the round trip is observed the only honest way there is: poll
  // until `reportedAt` advances. Two waves are expected — the device reports
  // immediately (current values) and again ~45 s later once the modem daemon
  // has honoured the re-probe — so polling continues briefly after the first
  // advance to catch the fresher second report.
  const [refreshing, setRefreshing] = useState(false)
  const refreshingRef = useRef(false)
  const refreshReport = useCallback(() => {
    if (refreshingRef.current || optimisticRef.current === null) return
    const before = optimisticRef.current.reportedAt
    refreshingRef.current = true
    setRefreshing(true)
    void (async () => {
      try {
        await xg().devices.refreshState(id)
        let advances = 0
        let lastSeen = before
        // 18 × 5 s = 90 s: covers the immediate report and the re-probe wave.
        for (let tick = 0; tick < 18; tick++) {
          await new Promise((r) => setTimeout(r, REPORT_POLL_MS))
          const fetched = await xg().devices.get(id)
          if (fetched.reportedAt === lastSeen) continue
          lastSeen = fetched.reportedAt
          advances += 1
          serverRef.current = fetched
          // Merge only the server-owned reported fields — same rule as the
          // pending poll above; the rest is live form state.
          applyDevice({
            ...(optimisticRef.current ?? fetched),
            status: fetched.status,
            lastSeenAt: fetched.lastSeenAt,
            configRev: fetched.configRev,
            reportedConfig: fetched.reportedConfig,
            reportedAt: fetched.reportedAt,
          })
          if (advances >= 2) return
        }
        if (advances === 0) {
          toast.info(
            "The device accepted the refresh but has not re-reported yet — give it a minute."
          )
        }
      } catch (err) {
        toast.error((err as Error).message)
      } finally {
        refreshingRef.current = false
        setRefreshing(false)
      }
    })()
  }, [id, applyDevice])

  // Generic report watcher (obd2-bluetooth-integration P3): the OBD scan is
  // a command whose answer arrives on the config report (`effective.obd.scan`)
  // rather than on the ack, so the card asks for the row until the scan it
  // requested shows up. Same merge rule as `refreshReport`: server-owned
  // fields only, never the live form state.
  const pollReport = useCallback(
    async (done: (device: Device) => boolean, maxTicks = 12): Promise<boolean> => {
      for (let tick = 0; tick < maxTicks; tick++) {
        await new Promise((r) => setTimeout(r, REPORT_POLL_MS))
        if (optimisticRef.current === null) return false
        const fetched = await xg().devices.get(id)
        serverRef.current = fetched
        applyDevice({
          ...(optimisticRef.current ?? fetched),
          status: fetched.status,
          lastSeenAt: fetched.lastSeenAt,
          configRev: fetched.configRev,
          obdScanRequestedAt: fetched.obdScanRequestedAt,
          reportedConfig: fetched.reportedConfig,
          reportedAt: fetched.reportedAt,
        })
        if (done(fetched)) return true
      }
      return false
    },
    [id, applyDevice]
  )

  // Remote agent update (device_update_management, Phase 4). Lives here rather
  // than in the tab component for the same reason `refreshReport` does: the
  // outcome is a change in the DEVICE row, so the poll must feed the one
  // `applyDevice` merge everything else reads from — two pollers writing
  // different copies of the device is how a row goes stale under the operator.
  //
  // There is no status flip that means "done". The update takes the agent down
  // and brings it back, and the only evidence it worked is a changed reported
  // build, so that is exactly what this waits for.
  const [updatingAgent, setUpdatingAgent] = useState(false)
  const updatingAgentRef = useRef(false)
  const updateAgent = useCallback((expectedVersion?: string | null, agent?: ReportedAgentKind | null) => {
    // The outcome hints name the updater unit of the agent being updated
    // (D4): a Rust device's journal is `xorgate-updater-rs`.
    const unit = updaterUnit(agent)
    if (updatingAgentRef.current || optimisticRef.current === null) return
    const before = reportedAgentBuild(optimisticRef.current)?.version ?? null
    updatingAgentRef.current = true
    setUpdatingAgent(true)
    void (async () => {
      try {
        await xg().devices.updateAgent(id)
        toast.success("Update command sent — the device will restart shortly")
        let sawOffline = false
        // 72 × 5 s = 6 min: the download + `npm ci` alone can take minutes on
        // a CM5 over LTE, and the plan budgets for that rather than declaring
        // failure while the device is still working.
        for (let tick = 0; tick < AGENT_UPDATE_POLL_TICKS; tick++) {
          await new Promise((r) => setTimeout(r, REPORT_POLL_MS))
          const fetched = await xg().devices.get(id)
          serverRef.current = fetched
          // Same merge rule as every other poll here: server-owned fields
          // only, never the live form state.
          applyDevice({
            ...(optimisticRef.current ?? fetched),
            status: fetched.status,
            lastSeenAt: fetched.lastSeenAt,
            configRev: fetched.configRev,
            agentVersion: fetched.agentVersion,
            reportedConfig: fetched.reportedConfig,
            reportedAt: fetched.reportedAt,
          })
          if (fetched.status !== "online") {
            sawOffline = true
            continue
          }
          const now = reportedAgentBuild(fetched)?.version ?? null
          if (now !== null && now !== before) {
            toast.success(`Updated to ${now}`)
            return
          }
          // Back online on the same build. Before it has dropped offline this
          // is just "the updater has not restarted it yet"; AFTER, it is the
          // outcome — and which outcome depends on what was being installed.
          if (sawOffline) {
            if (expectedVersion !== null && expectedVersion === before) {
              // The operator confirmed a reinstall of the version already
              // installed, so an unchanged build IS the success case. Saying
              // "may have failed" here would alarm them about the exact thing
              // the dialog told them was harmless.
              toast.success(`Reinstalled ${before}`)
            } else {
              toast.info(
                "The device came back on the same build. If you expected a new " +
                  "version, the update may have failed and rolled back — check " +
                  `\`journalctl -u ${unit}\` on the device.`
              )
            }
            return
          }
        }
        toast.error(
          "The device has not come back with a new build yet. Check the device " +
            `(\`journalctl -u ${unit}\`) before retrying.`
        )
      } catch (err) {
        // xgMessage, not err.message: a XorgateError's message carries the
        // "CODE METHOD url:" prefix for logs; the toast wants only
        // "Requires one of: owner, admin."
        toast.error(xgMessage(err))
      } finally {
        updatingAgentRef.current = false
        setUpdatingAgent(false)
      }
    })()
  }, [id, applyDevice])

  return {
    device,
    recording: resolveRecording(device?.config.recording ?? null),
    configStatus,
    error,
    notFound,
    isPending,
    commit,
    commitRecording,
    refreshReport,
    refreshing,
    pollReport,
    updateAgent,
    updatingAgent,
  }
}
