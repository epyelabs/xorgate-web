import { useEffect } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { ITEM_SOURCE_KINDS, ITEM_STATUSES, type ItemSourceKind, type ItemStatus } from "@/lib/models-schemas"
import { useDataset } from "@/queries/models"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import { Annotator, type AnnotateFilter } from "./-components/annotator/annotator"

// The full-page annotator, kept for deep links (docs, a shared URL). The
// dataset page opens the same component in a side sheet; this route is the
// fallback that lands anyone with a bookmark on a working editor.
export const Route = createFileRoute("/datasets/$id_/annotate/$itemId")({
  beforeLoad: requireAuth,
  validateSearch: (search: Record<string, unknown>): AnnotateFilter => ({
    status: ITEM_STATUSES.includes(search.status as ItemStatus) ? (search.status as ItemStatus) : undefined,
    class: typeof search.class === "string" ? search.class : undefined,
    source: ITEM_SOURCE_KINDS.includes(search.source as ItemSourceKind) ? (search.source as ItemSourceKind) : undefined,
  }),
  component: AnnotatorPage,
})

function AnnotatorPage() {
  const { id: datasetId, itemId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const dataset = useDataset(datasetId).data ?? null

  useEffect(() => {
    if (dataset) useBreadcrumbStore.getState().setDatasetName(dataset.name)
    return () => {
      useBreadcrumbStore.getState().setDatasetName(null)
    }
  }, [dataset])

  return (
    <Annotator
      datasetId={datasetId}
      itemId={itemId}
      filter={search}
      variant="page"
      onNavigate={(next) =>
        navigate({ to: "/datasets/$id/annotate/$itemId", params: { id: datasetId, itemId: next }, search, replace: true })
      }
      onExit={() => navigate({ to: "/datasets/$id", params: { id: datasetId }, search: {} })}
    />
  )
}
