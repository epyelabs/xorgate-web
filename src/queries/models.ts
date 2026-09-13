import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useCallback } from "react"
import {
  getAnnotations,
  getDataset,
  getModel,
  getTrainingJob,
  getVersion,
  listDatasetItems,
  listDatasets,
  listImports,
  listModels,
  listTrainingJobs,
  listVersions,
} from "@/lib/models-api"
import {
  isActiveImportStatus,
  isActiveTrainingStatus,
  type DatasetsListParams,
  type ItemsListParams,
  type ModelsListParams,
  type TrainingJobsListParams,
} from "@/lib/models-schemas"
import { qk } from "@/queries/keys"
import { useWorkspaceStore } from "@/store/workspace"

// Query hooks for the Models section. Datasets, jobs and registry entries are
// organization-wide (no workspace column, `requireOrgWideContext` on every
// route), so the keys hang off qk.org and the gates read the org id alone:
// a user with no workspace yet can still label a dataset.

function useOrg() {
  const orgId = useWorkspaceStore((s) => s.currentOrganizationId)
  return { orgId, ready: orgId !== null }
}

// Poll cadence while a job, import or version build is in flight (Q7:
// polling only in Phase 1). A job's terminal state arrives through
// EventBridge and can trail the container by 15 to 30 s; that lag is normal.
export const JOB_POLL_MS = 2500
const BUILD_POLL_MS = 2500

export function useDatasets(params: DatasetsListParams) {
  const { orgId, ready } = useOrg()
  return useQuery({
    queryKey: [...qk.datasets(orgId), { ...params }],
    queryFn: async () => {
      const res = await listDatasets(params)
      return { datasets: res.datasets, total: res.page?.total ?? res.datasets.length }
    },
    enabled: ready,
    placeholderData: keepPreviousData,
  })
}

export function useDataset(datasetId: string) {
  const { orgId, ready } = useOrg()
  return useQuery({
    queryKey: qk.dataset(orgId, datasetId),
    queryFn: () => getDataset(datasetId),
    enabled: ready,
  })
}

export function useDatasetItems(datasetId: string, params: ItemsListParams, enabled = true) {
  const { orgId, ready } = useOrg()
  return useQuery({
    queryKey: qk.datasetItems(orgId, datasetId, { ...params }),
    queryFn: async () => {
      const res = await listDatasetItems(datasetId, params)
      return { items: res.items, total: res.page?.total ?? res.items.length }
    },
    enabled: ready && enabled,
    placeholderData: keepPreviousData,
    // The presigned URLs on a page live 15 minutes; refetching on every focus
    // would re-decode the grid for nothing.
    staleTime: 60_000,
  })
}

/** One item's boxes plus its etag (the If-Match token) and a fresh image URL. */
export function useItemAnnotations(datasetId: string, itemId: string) {
  const { orgId, ready } = useOrg()
  return useQuery({
    queryKey: qk.datasetItemAnnotations(orgId, datasetId, itemId),
    queryFn: () => getAnnotations(datasetId, itemId),
    enabled: ready,
    // The annotator owns the working copy after the first read; a refetch on
    // focus would clobber unsaved edits with the server's older set.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
}

export function useDatasetVersions(datasetId: string) {
  const { orgId, ready } = useOrg()
  return useQuery({
    queryKey: qk.datasetVersions(orgId, datasetId),
    queryFn: () => listVersions(datasetId),
    enabled: ready,
    refetchInterval: ({ state }) =>
      state.data?.some((v) => v.status === "building") ? BUILD_POLL_MS : false,
  })
}

export function useDatasetVersion(datasetId: string, version: number | null) {
  const { orgId, ready } = useOrg()
  return useQuery({
    queryKey: qk.datasetVersion(orgId, datasetId, version ?? 0),
    queryFn: () => getVersion(datasetId, version as number),
    enabled: ready && version !== null,
  })
}

export function useDatasetImports(datasetId: string) {
  const { orgId, ready } = useOrg()
  return useQuery({
    queryKey: qk.datasetImports(orgId, datasetId),
    queryFn: () => listImports(datasetId),
    enabled: ready,
    refetchInterval: ({ state }) =>
      state.data?.some((i) => isActiveImportStatus(i.status)) ? BUILD_POLL_MS : false,
  })
}

export function useTrainingJobs(params: TrainingJobsListParams) {
  const { orgId, ready } = useOrg()
  return useQuery({
    queryKey: qk.trainingJobs(orgId, { ...params }),
    queryFn: async () => {
      const res = await listTrainingJobs(params)
      return { jobs: res.jobs, total: res.page?.total ?? res.jobs.length }
    },
    enabled: ready,
    placeholderData: keepPreviousData,
    // The list keeps moving while any row on it is in flight.
    refetchInterval: ({ state }) =>
      state.data?.jobs.some((j) => isActiveTrainingStatus(j.status)) ? JOB_POLL_MS : false,
  })
}

/**
 * One training or assist job. Self-regulating poll: `refetchInterval` reads
 * the query's own data, so the row polls at 2.5 s exactly while it reports
 * queued, dispatched or running and stops by itself on the terminal flip.
 */
export function useTrainingJob(jobId: string) {
  const { orgId, ready } = useOrg()
  return useQuery({
    queryKey: qk.trainingJob(orgId, jobId),
    queryFn: () => getTrainingJob(jobId),
    enabled: ready,
    refetchInterval: ({ state }) =>
      state.data && isActiveTrainingStatus(state.data.status) ? JOB_POLL_MS : false,
  })
}

export function useRegistryModels(params: ModelsListParams = {}) {
  const { orgId, ready } = useOrg()
  return useQuery({
    queryKey: qk.registryModels(orgId, { ...params }),
    queryFn: () => listModels(params),
    enabled: ready,
    placeholderData: keepPreviousData,
  })
}

export function useRegistryModel(modelId: string) {
  const { orgId, ready } = useOrg()
  return useQuery({
    queryKey: qk.registryModel(orgId, modelId),
    queryFn: () => getModel(modelId),
    enabled: ready,
  })
}

/** Refresh helpers after a mutation: one dataset (and everything under it), the lists, the registry. */
export function useInvalidateModels() {
  const { orgId } = useOrg()
  const queryClient = useQueryClient()
  const dataset = useCallback(
    (datasetId: string) => {
      void queryClient.invalidateQueries({ queryKey: qk.dataset(orgId, datasetId) })
      void queryClient.invalidateQueries({ queryKey: qk.datasets(orgId) })
    },
    [queryClient, orgId],
  )
  const datasets = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.datasets(orgId) })
  }, [queryClient, orgId])
  const jobs = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [...qk.org(orgId), "training-jobs"] })
    void queryClient.invalidateQueries({ queryKey: [...qk.org(orgId), "training-job"] })
  }, [queryClient, orgId])
  const registry = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [...qk.org(orgId), "registry-models"] })
    void queryClient.invalidateQueries({ queryKey: [...qk.org(orgId), "registry-model"] })
  }, [queryClient, orgId])
  return { dataset, datasets, jobs, registry }
}

/**
 * The ordered ids (and presigned URLs) of every item matching a filter, for
 * the annotator's prev / next and its preloading. Pages through the list at
 * the API's maximum page size; a dataset holds at most 5,000 items, so the
 * worst case is 25 calls, done once and cached for a few minutes.
 */
export function useDatasetItemSequence(
  datasetId: string,
  filter: Pick<ItemsListParams, "status" | "class" | "source">,
) {
  const { orgId, ready } = useOrg()
  return useQuery({
    queryKey: [...qk.dataset(orgId, datasetId), "sequence", { ...filter }],
    queryFn: async () => {
      const limit = 200
      const ids: string[] = []
      const urls = new Map<string, string | null>()
      let offset = 0
      let total = Infinity
      while (offset < total && ids.length < 5000) {
        const res = await listDatasetItems(datasetId, { ...filter, limit, offset, order: "asc" })
        for (const it of res.items) {
          ids.push(it.id)
          urls.set(it.id, it.url)
        }
        total = res.page?.total ?? res.items.length
        if (res.items.length === 0) break
        offset += limit
      }
      return { ids, urls }
    },
    enabled: ready,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
}
