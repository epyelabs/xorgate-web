import { useQuery } from "@tanstack/react-query"
import { isAgentKind, type ReportedAgentKind } from "@xorgate/sdk"
import { fetchAgentChannel, UNSUPPORTED_CHANNEL } from "@/lib/device-agent"
import { qk } from "@/queries/keys"
import { useTenant } from "@/queries/tenant"

// Which agent a device runs is on every `Device` (SDK 0.17.0 `device.agent`),
// so only the dist channel needs its own read. It is fleet-wide and changes
// only when CI publishes, so it is read once per screen, not polled.
const AGENT_STALE_MS = 60_000

/**
 * One agent's dist channel (`GET /device-dist/latest?agent=`). Disabled for an
 * agent this console does not know: there is no channel to ask about.
 */
export function useAgentChannel(agent: ReportedAgentKind | null | undefined) {
  const { orgId, wsId, ready } = useTenant()
  const known = isAgentKind(agent) ? agent : null
  return useQuery({
    queryKey: [...qk.ws(orgId, wsId), "agent-channel", known ?? ""] as const,
    queryFn: () =>
      known === null
        ? Promise.resolve(UNSUPPORTED_CHANNEL)
        : fetchAgentChannel(known),
    enabled: ready && known !== null,
    staleTime: AGENT_STALE_MS,
    retry: 1,
  })
}
