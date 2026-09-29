import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import {
  getDevicePurge,
  listDevicePurges,
  previewDevicePurge,
  type DevicePurge,
  type DevicePurgeStatus,
} from "@/lib/device-purge-api"
import { useInvalidateDevices } from "@/queries/devices"
import { qk } from "@/queries/keys"
import { useTenant } from "@/queries/tenant"

/** Poll cadence while the worker runs; the row is the authoritative state. */
const PURGE_POLL_MS = 2500

export function isPurgeActive(status: DevicePurgeStatus | undefined): boolean {
  return status === "queued" || status === "running"
}

/**
 * The counts the confirmation dialog shows. Fetched only while the dialog is
 * open and never cached across openings: the numbers are what the purge
 * would delete NOW, and a stale figure from an earlier look is worse than a
 * skeleton.
 */
export function useDevicePurgePreview(deviceId: string, enabled: boolean) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery({
    queryKey: qk.devicePurgePreview(orgId, wsId, deviceId),
    queryFn: () => previewDevicePurge(deviceId),
    enabled: ready && enabled,
    staleTime: 0,
    gcTime: 0,
  })
}

/**
 * The most recent purge of a device, or null when it has never been purged.
 * Drives the "Last purged" line and tells a freshly mounted page that a
 * purge is already in flight (so it can pick up polling it).
 */
export function useLatestDevicePurge(deviceId: string) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery({
    queryKey: qk.devicePurges(orgId, wsId, deviceId),
    queryFn: async () => {
      const { purges } = await listDevicePurges(deviceId, 1)
      return (purges[0] ?? null) as DevicePurge | null
    },
    enabled: ready,
  })
}

/**
 * One purge row. Self-regulating poll (the `useWorkflowInstance` idiom):
 * `refetchInterval` reads the query's own data, so the row polls at 2.5 s
 * exactly while it is queued or running and stops by itself on the terminal
 * flip. `purgeId` null disables the query outright.
 */
export function useDevicePurge(deviceId: string, purgeId: string | null) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery({
    queryKey: qk.devicePurge(orgId, wsId, deviceId, purgeId ?? ""),
    queryFn: async () => (await getDevicePurge(deviceId, purgeId!)).purge,
    enabled: ready && purgeId !== null,
    refetchInterval: ({ state }) =>
      isPurgeActive(state.data?.status) ? PURGE_POLL_MS : false,
  })
}

/**
 * Seed the polled row from a 202 body so the first status the page observes
 * is `queued`, not whatever the worker has reached by the first poll (a
 * small purge finishes in seconds, and the completion toast keys off the
 * transition).
 */
export function useSeedDevicePurge() {
  const { orgId, wsId } = useTenant()
  const queryClient = useQueryClient()
  return useCallback(
    (purge: DevicePurge) => {
      queryClient.setQueryData(
        qk.devicePurge(orgId, wsId, purge.deviceId, purge.id),
        purge
      )
    },
    [queryClient, orgId, wsId]
  )
}

/**
 * Everything a finished purge has emptied: the device's own subtree (its
 * attachments, runs, recorded sessions, telemetry, and the purge list
 * itself) plus the workspace-wide run list and run detail, which sit
 * outside the device key.
 */
export function useInvalidateAfterPurge() {
  const { orgId, wsId } = useTenant()
  const queryClient = useQueryClient()
  const invalidateDevices = useInvalidateDevices()
  return useCallback(
    (deviceId: string) => {
      invalidateDevices(deviceId)
      void queryClient.invalidateQueries({
        queryKey: [...qk.ws(orgId, wsId), "workflow-instances"],
      })
      void queryClient.invalidateQueries({
        queryKey: [...qk.ws(orgId, wsId), "workflow-instance"],
      })
    },
    [queryClient, orgId, wsId, invalidateDevices]
  )
}
