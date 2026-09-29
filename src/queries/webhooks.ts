import { useCallback } from "react"
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  getDeviceWebhooks,
  getWebhook,
  getWebhookDelivery,
  listWebhookDeliveries,
  listWebhooks,
  type WebhookDeliveryListParams,
} from "@/lib/webhooks-api"
import { qk } from "@/queries/keys"
import { useTenant } from "@/queries/tenant"

// The registry is small (a handful of endpoints per org), so one page of 100
// is "all of them" for the picker, the device routes dialog and the list page.
const ALL = { limit: 100, order: "asc" as const }

/** Every endpoint of the active organization (list page, pickers, badges). */
export function useWebhookEndpoints() {
  const { orgId } = useTenant()
  return useQuery({
    queryKey: qk.webhookList(orgId),
    queryFn: () => listWebhooks(ALL),
    enabled: orgId !== null,
  })
}

const POLL_MS = 3_000

// `pollUntil` (epoch ms) keeps a query polling for a while after an action
// (send test, redeliver): the delivery row is created by the fan-out a moment
// AFTER the request returns, so the first refetch can come back empty, and an
// empty page has no pending row to keep the polling going on its own.
const polling = (pollUntil: number | undefined) =>
  pollUntil !== undefined && Date.now() < pollUntil

export function useWebhookEndpoint(endpointId: string, pollUntil?: number) {
  const { orgId } = useTenant()
  return useQuery({
    queryKey: qk.webhook(orgId, endpointId),
    queryFn: () => getWebhook(endpointId),
    enabled: orgId !== null,
    refetchInterval: () => (polling(pollUntil) ? POLL_MS : false),
  })
}

// A delivery waiting on its first attempt or a retry is worth watching; poll
// while any row on the page is pending (or inside `pollUntil`), and stop once
// they all settle.
export function useWebhookDeliveries(
  endpointId: string,
  params: WebhookDeliveryListParams,
  pollUntil?: number
) {
  const { orgId } = useTenant()
  return useQuery({
    queryKey: qk.webhookDeliveries(orgId, endpointId, { ...params }),
    queryFn: () => listWebhookDeliveries(endpointId, params),
    enabled: orgId !== null,
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      polling(pollUntil) ||
      query.state.data?.deliveries.some((d) => d.status === "pending")
        ? POLL_MS
        : false,
  })
}

export function useWebhookDelivery(endpointId: string, deliveryId: string | null) {
  const { orgId } = useTenant()
  return useQuery({
    queryKey: qk.webhookDelivery(orgId, endpointId, deliveryId ?? ""),
    queryFn: () => getWebhookDelivery(endpointId, deliveryId!),
    enabled: orgId !== null && deliveryId !== null,
  })
}

/** Refreshes the list, every endpoint detail and every delivery log. */
export function useInvalidateWebhooks() {
  const { orgId } = useTenant()
  const queryClient = useQueryClient()
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.webhooks(orgId) })
  }, [queryClient, orgId])
}

/** A device's webhook routes (device Settings -> Webhooks). */
export function useDeviceWebhooks(deviceId: string, enabled = true) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery({
    queryKey: qk.deviceWebhooks(orgId, wsId, deviceId),
    queryFn: () => getDeviceWebhooks(deviceId),
    enabled: ready && enabled,
  })
}
