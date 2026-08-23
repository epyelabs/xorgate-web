import { create } from "zustand"
import { xg, xgMessage } from "@/lib/xorgate"
import { mergeMockFunctionNodes } from "@/lib/code-function-mock"
import {
  type CatalogNode,
  type WorkflowCatalog,
  workflowCatalogSchema,
} from "@/lib/workflow-catalog-schemas"

// The served node catalog (GET /workflow-catalog), fetched once per session and
// shared by the palette, node cards, config forms, and canvas edge validation.
// The response is static per backend deployment and ETag'd server-side with
// `Cache-Control: no-cache`, so the browser's HTTP cache handles revalidation;
// in-memory memoization is all this store adds. Load it via `ensureLoaded()`
// from any screen that needs it (the template editor does).

type CatalogStatus = "idle" | "loading" | "ready" | "error"

interface WorkflowCatalogState {
  catalog: WorkflowCatalog | null
  byType: Record<string, CatalogNode>
  status: CatalogStatus
  error: string | null
  ensureLoaded: () => Promise<void>
}

export const useWorkflowCatalog = create<WorkflowCatalogState>((set, get) => ({
  catalog: null,
  byType: {},
  status: "idle",
  error: null,

  ensureLoaded: async () => {
    const { status } = get()
    if (status === "loading" || status === "ready") return
    set({ status: "loading", error: null })
    try {
      // Workflows are outside the SDK's modeled surface; xg().request() is
      // its documented escape hatch (auth + tenancy + /v1 still applied).
      const raw = await xg().request<unknown>("GET", "/workflow-catalog")
      const parsed = workflowCatalogSchema.safeParse(raw)
      if (!parsed.success) {
        throw new Error("Unexpected /workflow-catalog response shape")
      }
      // UI/UX mockup: the "Code Function" category is injected client-side
      // until the backend serves function.* node types (skipped per-type once
      // it does — see code-function-mock.ts).
      const catalog = mergeMockFunctionNodes(parsed.data)
      set({
        catalog,
        byType: Object.fromEntries(catalog.nodes.map((n) => [n.type, n])),
        status: "ready",
      })
    } catch (err) {
      set({ status: "error", error: xgMessage(err) })
    }
  },
}))
