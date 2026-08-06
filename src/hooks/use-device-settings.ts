import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  ApiError,
  getDevice,
  patchDeviceConfig,
  patchDeviceUiPrefs,
  updateDevice,
  type ActiveStreamsViewType,
  type Device,
  type DeviceConfigPatch,
  type DeviceUiPrefsPatch,
  type ImuMount,
  type ImuView,
  type LteRecoveryConfig,
  type RecordingConfig,
  type TimeSyncConfig,
} from "@/lib/api"
import { getDeviceResponseSchema } from "@/lib/schemas"
import {
  buildRecordingConfig,
  resolveRecording,
  type ResolvedRecording,
} from "@/lib/device-config-defaults"
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
// patch is still keyed by DEVICE FIELD (`recordingConfig`, `imuView`, `name`),
// and this hook routes each key to the endpoint that owns it —
// `PATCH /devices/{id}/config` for anything delivered to the device,
// `PATCH /devices/{id}/ui-prefs` for cloud-only prefs, `PUT /devices/{id}` for
// metadata. Tabs still READ the dual-written top-level fields; when the
// follow-up migration drops those columns, the reads move to `device.config`
// and this mapping is what tells you where each one goes.

/**
 * Patch keys are device fields, not namespaces — that indirection is what let
 * the transport change land in this file alone.
 */
export interface DeviceSettingsPatch {
  name?: string | null
  firmwareVersion?: string | null
  gnssAntBias?: boolean
  imuMount?: ImuMount | null
  recordingConfig?: RecordingConfig | null
  lteRecoveryConfig?: LteRecoveryConfig | null
  timeSyncConfig?: TimeSyncConfig | null
  activeStreamsViewType?: ActiveStreamsViewType
  imuView?: ImuView | null
}

/** Device field -> config namespace (`PATCH /devices/{id}/config`). */
const CONFIG_FIELDS = {
  gnssAntBias: "gnssAntBias",
  imuMount: "imuMount",
  recordingConfig: "recording",
  lteRecoveryConfig: "lteRecovery",
  timeSyncConfig: "timeSync",
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

/** Structural equality — the single change-detection strategy for the page. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  ) {
    return false
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao)
  if (ak.length !== Object.keys(bo).length) return false
  return ak.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k])
  )
}

export interface DeviceSettings {
  /** Optimistic device object — the source of truth for every control. */
  device: Device | null
  /** Recording namespace resolved over the device defaults. */
  recording: ResolvedRecording
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
}

export function useDeviceSettings(id: string): DeviceSettings {
  const [device, setDevice] = useState<Device | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  // key -> in-flight count (a key can be queued more than once).
  const [pending, setPending] = useState<Record<string, number>>({})

  // What the UI shows (state + optimistic edits) and what a failed save rolls
  // back to. Refs because commits are built from the latest value, not from
  // whatever this render closed over.
  const optimisticRef = useRef<Device | null>(null)
  const serverRef = useRef<Device | null>(null)
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
        const raw = await getDevice(id)
        const parsed = getDeviceResponseSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error("Unexpected /devices/:id response shape")
        }
        if (cancelled) return
        const fetched = parsed.data.device
        serverRef.current = fetched
        applyDevice(fetched)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          if (!cancelled) setNotFound(true)
          return
        }
        const message = (err as Error).message
        if (!cancelled) setError(message)
        toast.error(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, applyDevice])

  const commit = useCallback(
    (key: string, patch: DeviceSettingsPatch) => {
      const current = optimisticRef.current
      if (current === null) return

      // Drop undefined entries so a spread can never blank a stored field.
      const updates = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined)
      ) as DeviceSettingsPatch
      const keys = Object.keys(updates) as (keyof Device)[]
      if (keys.length === 0) return

      const next = { ...current, ...(updates as Partial<Device>) }
      // Nothing actually changed (an incidental blur, a re-select of the value
      // already stored) — don't hit the API.
      if (keys.every((k) => deepEqual(current[k], next[k]))) return

      // Mirror the optimistic edit into the consolidated document too, so the
      // two views of the same setting never disagree mid-flight.
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
          const metaPatch: { name?: string | null; firmwareVersion?: string | null } = {}
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
            updated = (await updateDevice(id, metaPatch)).device
          }
          if (Object.keys(configPatch).length > 0) {
            updated = (await patchDeviceConfig(id, configPatch)).device
          }
          if (Object.keys(uiPrefsPatch).length > 0) {
            updated = (await patchDeviceUiPrefs(id, uiPrefsPatch)).device
          }
          if (updated === null) throw new Error("Nothing to save")
          serverRef.current = updated
          // Re-seed only the fields this save owns: later queued edits are
          // already optimistically applied and must survive.
          const merged = { ...(optimisticRef.current ?? updated) }
          for (const k of keys) {
            ;(merged as Record<string, unknown>)[k] = updated[k]
          }
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
    [id, applyDevice, bumpPending]
  )

  const commitRecording = useCallback(
    (key: string, mutate: (r: ResolvedRecording) => void) => {
      const current = optimisticRef.current
      if (current === null) return
      const stored = current.recordingConfig
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

  return {
    device,
    recording: resolveRecording(device?.recordingConfig ?? null),
    error,
    notFound,
    isPending,
    commit,
    commitRecording,
  }
}
