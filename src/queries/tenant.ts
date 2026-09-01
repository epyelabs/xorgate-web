import { useWorkspaceStore } from "@/store/workspace"

/**
 * The active tenant for query keys and `enabled` gates. Reads the same store
 * that feeds the `xg()` client's headers, so a key built from this can never
 * disagree with the request it labels.
 */
export function useTenant() {
  const orgId = useWorkspaceStore((s) => s.currentOrganizationId)
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId)
  return { orgId, wsId, ready: orgId !== null && wsId !== null }
}
