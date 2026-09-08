import { create } from "zustand"
import { xg, xgMessage } from "@/lib/xorgate"
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
      // The "Code Function" category (function.javascript / function.python)
      // is served by the backend like every other node since
      // @xorgate/workflow-engine 0.3.0; nothing is injected client-side. The
      // Test tab of the function editor is still local (code-function-runtime.ts).
      const catalog = parsed.data
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
