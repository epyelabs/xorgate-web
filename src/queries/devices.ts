import { useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { Device, DeviceModel } from "@xorgate/sdk"
import { xg } from "@/lib/xorgate"
import { FLEET_POLL_MS } from "@/lib/freshness"
import { qk } from "@/queries/keys"
import { useTenant } from "@/queries/tenant"

// The KPI tiles aggregate the whole fleet, so the fleet query loads every
// device (in pages of FLEET_PAGE) and screens slice/filter/sort client-side.
// FLEET_CAP guards against an unbounded load on a very large fleet.
const FLEET_PAGE = 500
const FLEET_CAP = 5000

async function fetchFleet(): Promise<Device[]> {
  const all: Device[] = []
  let offset = 0
  let total = Infinity
  while (offset < total && all.length < FLEET_CAP) {
    const { items, page } = await xg().devices.list({
      limit: FLEET_PAGE,
      offset,
    })
    all.push(...items)
    total = page.total
    if (items.length === 0) break
    offset += FLEET_PAGE
  }
  return all
}

/**
 * The whole fleet, in the server's updatedAt-desc order.
 *
 * `poll` is per-caller on purpose: every screen may read this key, but only
 * the ones that SHOW device state should be driving requests for it. React
 * Query merges the options of every observer on a key, so one polling reader
 * keeps it current for all of them.
 */
export function useFleet({ poll = false }: { poll?: boolean } = {}) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery({
    queryKey: qk.fleet(orgId, wsId),
    queryFn: fetchFleet,
    enabled: ready,
    refetchInterval: poll ? FLEET_POLL_MS : false,
  })
}

/**
 * One device. Seeded from the fleet cache when the row is already there, so
 * opening a device from the list paints the header with the row that was
 * clicked while the authoritative fetch runs behind it.
 *
 * `observeOnly` subscribes to the cache entry without ever fetching it: for a
 * component inside the device layout, whose own `useDevice(id, { poll: true })`
 * already keeps the entry fresh. A second fetching observer would add a read on
 * every mount (the default staleTime is 0).
 */
export function useDevice(
  deviceId: string,
  {
    poll = false,
    observeOnly = false,
  }: { poll?: boolean; observeOnly?: boolean } = {}
) {
  const { orgId, wsId, ready } = useTenant()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: qk.device(orgId, wsId, deviceId),
    queryFn: () => xg().devices.get(deviceId),
    enabled: ready && !observeOnly,
    refetchInterval: poll ? FLEET_POLL_MS : false,
    placeholderData: () =>
      queryClient
        .getQueryData<Device[]>(qk.fleet(orgId, wsId))
        ?.find((d) => d.id === deviceId),
  })
}

// The catalog changes on the order of releases, not seconds; don't make every
// screen that names a model re-ask for it.
const MODEL_STALE_MS = 10 * 60_000

/** The platform model catalog (names for Model columns, and the dialogs). */
export function useDeviceModels() {
  const { orgId, ready } = useTenant()
  return useQuery({
    queryKey: qk.deviceModels(orgId),
    queryFn: () => xg().deviceModels.list(),
    enabled: ready,
    staleTime: MODEL_STALE_MS,
  })
}

/** One model, keyed by id so every tab of a device shares the same answer. */
export function useDeviceModel(modelId: string | undefined) {
  const { orgId, ready } = useTenant()
  return useQuery({
    queryKey: qk.deviceModel(orgId, modelId ?? ""),
    queryFn: () => xg().deviceModels.get(modelId!),
    enabled: ready && !!modelId,
    staleTime: MODEL_STALE_MS,
  })
}

/**
 * Invalidator for device data after a write. With no argument it refreshes
 * the fleet list; with a device id it also refreshes that device's subtree
 * (the device itself plus its telemetry/session/workflow queries, which all
 * extend the device key).
 */
export function useInvalidateDevices() {
  const { orgId, wsId } = useTenant()
  const queryClient = useQueryClient()
  return useCallback(
    (deviceId?: string) => {
      void queryClient.invalidateQueries({ queryKey: qk.fleet(orgId, wsId) })
      if (deviceId) {
        void queryClient.invalidateQueries({
          queryKey: qk.device(orgId, wsId, deviceId),
        })
      }
    },
    [queryClient, orgId, wsId]
  )
}

/**
 * The cached row for a device, for non-React seams (use-device-settings seeds
 * its local copy from here so the Settings tab paints without a skeleton).
 */
export function getCachedDevice(
  queryClient: ReturnType<typeof useQueryClient>,
  orgId: string | null,
  wsId: string | null,
  deviceId: string
): Device | undefined {
  return (
    queryClient.getQueryData<Device>(qk.device(orgId, wsId, deviceId)) ??
    queryClient
      .getQueryData<Device[]>(qk.fleet(orgId, wsId))
      ?.find((d) => d.id === deviceId)
  )
}

export type { Device, DeviceModel }
