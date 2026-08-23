import { xg } from "./xorgate"
import type { SearchResult } from "@xorgate/sdk"

export type SearchResultType = SearchResult["type"]

// Global cross-resource search, through the SDK's modeled client.search()
// (which normalizes the {results} envelope away). The shape is deliberately
// generic so the palette renders any resource type from one code path; adding
// a resource = a backend query block + a SEARCH_RESOURCES entry.

export type { SearchResult }

// The client attaches the Cognito token + X-Organization-Id / X-Workspace-Id
// headers, so results are scoped to the active org server-side.
export async function searchGlobal(
  q: string
): Promise<{ results: SearchResult[] }> {
  return { results: await xg().search(q) }
}
