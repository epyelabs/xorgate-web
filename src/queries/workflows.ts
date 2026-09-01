import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useCallback } from "react"
import {
  listDeviceAttachments,
  listDeviceRuns,
} from "@/lib/device-workflows-api"
import {
  listDeviceAttachmentsResponseSchema,
  type DeviceWorkflowAttachment,
} from "@/lib/device-workflow-schemas"
import {
  getWorkflowRunResponseSchema,
  listWorkflowRunsResponseSchema,
  type WorkflowRunsListParams,
} from "@/lib/workflow-run-schemas"
import {
  getWorkflowInstance,
  listWorkflowInstances,
} from "@/lib/workflow-instances-api"
import { listWorkflowTemplates } from "@/lib/workflow-templates-api"
import {
  listWorkflowTemplatesResponseSchema,
  type WorkflowTemplatesListParams,
} from "@/lib/workflow-schemas"
import { qk } from "@/queries/keys"
import { useTenant } from "@/queries/tenant"

// Every fetch validates the untyped `xg().request` payload with the same zod
// schemas the routes used inline, so components read typed data straight from
// the cache and a shape drift still fails loudly at the seam.

function parseRunsList(raw: unknown) {
  const parsed = listWorkflowRunsResponseSchema.safeParse(raw)
  if (!parsed.success) throw new Error("Unexpected workflow runs response shape")
  return {
    runs: parsed.data.runs,
    total: parsed.data.page?.total ?? parsed.data.runs.length,
  }
}

/** Workflows attached to one device (small per-device config list). */
export function useDeviceAttachments(deviceId: string) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery({
    queryKey: qk.deviceAttachments(orgId, wsId, deviceId),
    queryFn: async () => {
      const parsed = listDeviceAttachmentsResponseSchema.safeParse(
        await listDeviceAttachments(deviceId)
      )
      if (!parsed.success)
        throw new Error("Unexpected device workflows response shape")
      return parsed.data.attachments
    },
    enabled: ready,
  })
}

/**
 * Surgical cache edits for the attachments list. The write endpoints answer
 * with the affected attachment, so attach/detach/run-now write straight into
 * the cached list instead of invalidating: the row the operator just touched
 * updates in the same frame with no round trip.
 */
export function useDeviceAttachmentsCache(deviceId: string) {
  const { orgId, wsId } = useTenant()
  const queryClient = useQueryClient()
  const key = qk.deviceAttachments(orgId, wsId, deviceId)

  const prepend = useCallback(
    (attachment: DeviceWorkflowAttachment) => {
      queryClient.setQueryData<DeviceWorkflowAttachment[]>(key, (prev) =>
        prev ? [attachment, ...prev] : [attachment]
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, orgId, wsId, deviceId]
  )
  const replace = useCallback(
    (attachment: DeviceWorkflowAttachment) => {
      queryClient.setQueryData<DeviceWorkflowAttachment[]>(key, (prev) =>
        prev ? prev.map((a) => (a.id === attachment.id ? attachment : a)) : prev
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, orgId, wsId, deviceId]
  )
  const remove = useCallback(
    (attachmentId: string) => {
      queryClient.setQueryData<DeviceWorkflowAttachment[]>(key, (prev) =>
        prev ? prev.filter((a) => a.id !== attachmentId) : prev
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, orgId, wsId, deviceId]
  )
  return { prepend, replace, remove }
}

/** One page of a device's workflow runs (device Workflows tab). */
export function useDeviceWorkflowRuns(
  deviceId: string,
  params: WorkflowRunsListParams
) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery({
    queryKey: qk.deviceWorkflowRuns(orgId, wsId, deviceId, { ...params }),
    queryFn: async () => parseRunsList(await listDeviceRuns(deviceId, params)),
    enabled: ready,
    // Paging keeps the current rows on screen while the next page loads.
    placeholderData: keepPreviousData,
  })
}

/** One page of the workspace's workflow runs (Workflow Instances list). */
export function useWorkflowInstances(params: WorkflowRunsListParams) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery({
    queryKey: qk.workflowInstances(orgId, wsId, { ...params }),
    queryFn: async () => parseRunsList(await listWorkflowInstances(params)),
    enabled: ready,
    placeholderData: keepPreviousData,
  })
}

// Poll cadence while a run executes; the QoS-0 progress topics are the live
// view, this is the authoritative terminal state.
const RUN_POLL_MS = 2500

/**
 * One workflow run. Self-regulating poll (the alocate convergence pattern):
 * `refetchInterval` reads the query's own data, so the row polls at 2.5s
 * exactly while it reports `running` and stops by itself on the terminal
 * flip — no effect juggling, and a transient poll failure keeps the last
 * good detail on screen.
 */
export function useWorkflowInstance(instanceId: string) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery({
    queryKey: qk.workflowInstance(orgId, wsId, instanceId),
    queryFn: async () => {
      const parsed = getWorkflowRunResponseSchema.safeParse(
        await getWorkflowInstance(instanceId)
      )
      if (!parsed.success)
        throw new Error("Unexpected /workflow-runs/:id response shape")
      return parsed.data.run
    },
    enabled: ready,
    refetchInterval: ({ state }) =>
      state.data?.status === "running" ? RUN_POLL_MS : false,
  })
}

/** One page of workflow templates (Workflow Templates list). */
export function useWorkflowTemplates(params: WorkflowTemplatesListParams) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery({
    queryKey: [...qk.workflowTemplates(orgId, wsId), { ...params }],
    queryFn: async () => {
      const parsed = listWorkflowTemplatesResponseSchema.safeParse(
        await listWorkflowTemplates(params)
      )
      if (!parsed.success)
        throw new Error("Unexpected /workflow-templates response shape")
      return {
        templates: parsed.data.templates,
        total: parsed.data.page?.total ?? parsed.data.templates.length,
      }
    },
    enabled: ready,
    placeholderData: keepPreviousData,
  })
}

/** Refresh the templates list after a create/delete. */
export function useInvalidateWorkflowTemplates() {
  const { orgId, wsId } = useTenant()
  const queryClient = useQueryClient()
  return useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: qk.workflowTemplates(orgId, wsId),
    })
  }, [queryClient, orgId, wsId])
}
