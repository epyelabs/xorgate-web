import { apiRequest } from "./api"

// Global cross-resource search. Mirrors the normalized result contract returned by
// the backend GET /search handler (xorgate-core-service/src/handlers/search.ts).
// The shape is deliberately generic so the palette renders any resource type from
// one code path; adding a resource = a backend query block + a SEARCH_RESOURCES entry.

export type SearchResultType =
  | "device"
  | "workflow-template"
  | "workflow-instance"

export interface SearchResult {
  type: SearchResultType
  id: string
  title: string
  subtitle: string | null
}

// apiRequest already attaches the Cognito token + X-Organization-Id / X-Workspace-Id
// headers, so results are scoped to the active org server-side.
export async function searchGlobal(
  q: string
): Promise<{ results: SearchResult[] }> {
  return apiRequest(`/search?q=${encodeURIComponent(q)}`)
}
