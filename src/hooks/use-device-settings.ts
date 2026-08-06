import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ApiError, getDevice, updateDevice, type Device } from "@/lib/api"
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
// Phase 2 of the "improve device settings management" plan swaps the transport
// underneath (`PATCH /devices/{id}/config`) — the control-facing API here is
// meant to survive that unchanged.

/** Update payload accepted by `PUT /devices/{id}` (see api.ts `updateDevice`). */
export type DeviceSettingsPatch = NonNullable<Parameters<typeof updateDevice>[1]>

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
          const { device: updated } = await updateDevice(id, updates)
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
