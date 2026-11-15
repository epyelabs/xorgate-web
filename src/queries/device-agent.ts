import { useQuery } from "@tanstack/react-query"
import {
  fetchAgentChannel,
  fetchDeviceAgent,
  fetchFleetAgents,
  isAgentKind,
  type ReportedAgentKind,
} from "@/lib/agent-channel"
import { qk } from "@/queries/keys"
import { useTenant } from "@/queries/tenant"

// Which agent a device runs changes only at a claim (or when a converted
// device's Rust build first reports its marker), so these are read once per
// screen, not polled. Both hang off the fleet / device keys, so the existing
// invalidations after a claim, delete or transfer refresh them too.
const AGENT_STALE_MS = 60_000

/**
 * `devices.agent` for the whole fleet, keyed by device id. Temporary: SDK 0.15
 * strips the field, so this is a second, raw list read (agent-channel.ts);
 * WP-C2 reads `device.agent` off the fleet rows instead.
 */
export function useFleetAgents() {
  const { orgId, wsId, ready } = useTenant()
  return useQuery({
    queryKey: [...qk.fleet(orgId, wsId), "agents"] as const,
    queryFn: fetchFleetAgents,
    enabled: ready,
    staleTime: AGENT_STALE_MS,
  })
}

/** `devices.agent` for one device (`js` on a backend that predates it). */
export function useDeviceAgent(deviceId: string) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery({
    queryKey: [...qk.device(orgId, wsId, deviceId), "agent"] as const,
    queryFn: () => fetchDeviceAgent(deviceId),
    enabled: ready && deviceId !== "",
    staleTime: AGENT_STALE_MS,
  })
}

/**
 * One agent's dist channel (`GET /device-dist/latest?agent=`). Disabled for an
 * agent this console does not know: there is no channel to ask about.
 */
export function useAgentChannel(agent: ReportedAgentKind | null | undefined) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery({
    queryKey: [...qk.ws(orgId, wsId), "agent-channel", agent ?? ""] as const,
    queryFn: () => fetchAgentChannel(agent as "js" | "rust"),
    enabled: ready && isAgentKind(agent),
    staleTime: AGENT_STALE_MS,
    retry: 1,
  })
}
