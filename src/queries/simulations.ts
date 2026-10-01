import { useQuery } from "@tanstack/react-query"
import { xg } from "@/lib/xorgate"
import { FLEET_POLL_MS } from "@/lib/freshness"
import { qk } from "@/queries/keys"
import { useTenant } from "@/queries/tenant"

// Thumbnails are presigned for an hour; refetch well inside that so an open
// picker never shows a broken image.
const SCENARIOS_STALE_MS = 20 * 60_000

/** The scenario catalog (`devices.simulations.scenarios.list()`). */
export function useSimulationScenarios({ enabled = true }: { enabled?: boolean } = {}) {
  const { orgId, ready } = useTenant()
  return useQuery({
    queryKey: qk.simulationScenarios(orgId),
    queryFn: () => xg().devices.simulations.scenarios.list(),
    enabled: ready && enabled,
    staleTime: SCENARIOS_STALE_MS,
    refetchInterval: SCENARIOS_STALE_MS,
  })
}

/** How often to ask the host while a sim is on its way up (or parked). */
export const SIMULATION_FAST_POLL_MS = 3_000

/**
 * A simulated device's host report. `enabled` must be false for a real device
 * (the route 404s for one). `fast` is for the moments the host report is the
 * only progress signal: starting, parked, powering on.
 */
export function useDeviceSimulation(
  deviceId: string,
  { enabled = true, fast = false }: { enabled?: boolean; fast?: boolean } = {}
) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery({
    queryKey: qk.deviceSimulation(orgId, wsId, deviceId),
    queryFn: () => xg().devices.simulations.get(deviceId),
    enabled: ready && enabled,
    refetchInterval: fast ? SIMULATION_FAST_POLL_MS : FLEET_POLL_MS,
  })
}
