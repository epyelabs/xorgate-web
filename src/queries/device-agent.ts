import { useCallback } from "react"
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query"
import type { AgentKind, ReportedAgentKind } from "@xorgate/sdk"
import { agentChannelQuery, fetchAgentChannel } from "@/lib/device-agent"
import { qk } from "@/queries/keys"
import { useTenant } from "@/queries/tenant"

// Which agent a device runs is on every `Device` (SDK 0.17.0 `device.agent`),
// so only the dist channel needs its own read. It is fleet-wide and changes
// only when CI publishes, so it is read once per screen, not polled.
const AGENT_STALE_MS = 60_000

/**
 * The cache key of one agent's channel. Per org AND workspace: the answer's
 * `registrationEnabled` is the stage flag resolved for this workspace, so one
 * workspace's answer must never serve another.
 */
export function agentChannelKey(
  orgId: string | null,
  wsId: string | null,
  agent: AgentKind | ""
) {
  return [...qk.ws(orgId, wsId), "agent-channel", agent] as const
}

/**
 * One agent's dist channel (`GET /device-dist/latest?agent=`). Disabled for an
 * agent this console does not know: there is no channel to ask about.
 */
export function useAgentChannel(agent: ReportedAgentKind | null | undefined) {
  const { orgId, wsId, ready } = useTenant()
  const q = agentChannelQuery(agent)
  return useQuery({
    queryKey: agentChannelKey(orgId, wsId, q.known ?? ""),
    queryFn: q.queryFn,
    enabled: ready && q.enabled,
    staleTime: AGENT_STALE_MS,
    retry: 1,
  })
}

/**
 * The Rust channel as Register device reads it: the same cache entry the
 * device screens use, fresh for 60 s. No retry: the dialog reads a failure as
 * "could not check" (JS) at once, and the next open asks again.
 */
export function rustChannelOptions(orgId: string | null, wsId: string | null) {
  return queryOptions({
    queryKey: agentChannelKey(orgId, wsId, "rust"),
    queryFn: () => fetchAgentChannel("rust"),
    staleTime: AGENT_STALE_MS,
    retry: false,
  })
}

/**
 * Warm the Rust channel for the active workspace, so Register device usually
 * opens without waiting for it. A no-op while the entry is fresh or already
 * being fetched; a failure is dropped (the dialog asks for itself).
 */
export function usePrefetchRustChannel(): () => void {
  const queryClient = useQueryClient()
  const { orgId, wsId, ready } = useTenant()
  return useCallback(() => {
    if (!ready) return
    void queryClient.prefetchQuery(rustChannelOptions(orgId, wsId))
  }, [queryClient, orgId, wsId, ready])
}
