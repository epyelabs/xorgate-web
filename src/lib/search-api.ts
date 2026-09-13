import { xg } from "./xorgate"
import type { SearchResult as SdkSearchResult } from "@xorgate/sdk"

// The SDK's union predates the Models section; datasets and registry models
// are searchable since xorgate-models M4 (backend search.ts) and are widened
// here until the SDK's own type catches up.
export type SearchResultType = SdkSearchResult["type"] | "dataset" | "model"
export type SearchResult = Omit<SdkSearchResult, "type"> & { type: SearchResultType }

// Global cross-resource search, through the SDK's modeled client.search()
// (which normalizes the {results} envelope away). The shape is deliberately
// generic so the palette renders any resource type from one code path; adding
// a resource = a backend query block + a SEARCH_RESOURCES entry.

// The client attaches the Cognito token + X-Organization-Id / X-Workspace-Id
// headers, so results are scoped to the active org server-side.
export async function searchGlobal(
  q: string
): Promise<{ results: SearchResult[] }> {
  return { results: (await xg().search(q)) as SearchResult[] }
}
