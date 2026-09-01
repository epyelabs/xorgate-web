import { useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { xg } from "@/lib/xorgate"
import { qk } from "@/queries/keys"
import { useTenant } from "@/queries/tenant"

/** The active organization's memberships (Members page). */
export function useMembers() {
  const { orgId } = useTenant()
  return useQuery({
    queryKey: qk.members(orgId),
    queryFn: () => xg().memberships.list(),
    enabled: orgId !== null,
  })
}

export function useInvalidateMembers() {
  const { orgId } = useTenant()
  const queryClient = useQueryClient()
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.members(orgId) })
  }, [queryClient, orgId])
}

/** The active organization's API keys (API Keys page). */
export function useApiKeys() {
  const { orgId } = useTenant()
  return useQuery({
    queryKey: qk.apiKeys(orgId),
    queryFn: () => xg().apiKeys.list(),
    enabled: orgId !== null,
  })
}

export function useInvalidateApiKeys() {
  const { orgId } = useTenant()
  const queryClient = useQueryClient()
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.apiKeys(orgId) })
  }, [queryClient, orgId])
}
