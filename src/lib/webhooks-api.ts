import { xg } from "./xorgate"

// Webhooks (plans/xorgate-webhooks, Phase 4). The raw `xg().request` pattern
// (org-credentials-api.ts) rather than the SDK resource: `xg.webhooks` ships in
// @xorgate/sdk 0.9.0, which the app can switch to once it is published.
//
// Two kinds of routing point at one org registry of endpoints (URL + signing
// secret): a workflow template's output.event node names an endpoint in its
// `webhook` field, and a device routes its presence and session events per
// endpoint (GET/PUT /devices/{id}/webhooks, cloud-side only, never part of the
// config that syncs to the device). The signing secret is returned exactly
// once, by create and rotate; nothing here keeps it.

export const DEVICE_WEBHOOK_EVENT_TYPES = [
  "device.online",
  "device.offline",
  "media_session.started",
  "media_session.ended",
  "telemetry_session.started",
  "telemetry_session.ended",
  "telemetry_session.completed",
] as const
export type DeviceWebhookEventType = (typeof DEVICE_WEBHOOK_EVENT_TYPES)[number]

export type WebhookEventType = DeviceWebhookEventType | "workflow.event" | "ping"

// The device Settings -> Webhooks sub-tab's checkbox groups.
export const DEVICE_WEBHOOK_EVENT_GROUPS: {
  label: string
  types: { type: DeviceWebhookEventType; label: string }[]
}[] = [
  {
    label: "Presence",
    types: [
      { type: "device.online", label: "Online" },
      { type: "device.offline", label: "Offline" },
    ],
  },
  {
    label: "Media sessions",
    types: [
      { type: "media_session.started", label: "Started" },
      { type: "media_session.ended", label: "Ended" },
    ],
  },
  {
    label: "Telemetry sessions",
    types: [
      { type: "telemetry_session.started", label: "Started" },
      { type: "telemetry_session.ended", label: "Ended" },
      { type: "telemetry_session.completed", label: "Completed" },
    ],
  },
]

export interface WebhookEndpoint {
  id: string
  organizationId: string
  name: string
  url: string
  description: string | null
  secretVersion: number
  enabled: boolean
  disabledAt: string | null
  /** "manual" (PATCH enabled:false) or "gone" (the receiver answered 410). */
  disabledReason: string | null
  /** Exhausted deliveries in a row. */
  consecutiveFailures: number
  lastDeliveryAt: string | null
  lastSuccessAt: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface WebhookDeliveryStats {
  windowHours: number
  pending: number
  delivered: number
  failed: number
  exhausted: number
}

export type WebhookEndpointDetail = WebhookEndpoint & {
  deliveryStats?: WebhookDeliveryStats
}

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed" | "exhausted"

export interface WebhookDelivery {
  id: string
  eventId: string
  eventType?: WebhookEventType
  endpointId: string
  redeliveryOf: string | null
  status: WebhookDeliveryStatus
  attempt: number
  nextAttemptAt: string | null
  responseStatus: number | null
  responseMs: number | null
  error: string | null
  deliveredAt: string | null
  createdAt: string
  updatedAt: string
}

export interface WebhookEventEnvelope {
  id: string
  type: WebhookEventType
  apiVersion: string
  createdAt: string
  organizationId: string
  workspaceId: string | null
  data: Record<string, unknown>
}

export type WebhookDeliveryDetail = WebhookDelivery & {
  responseExcerpt?: string | null
  event?: WebhookEventEnvelope | null
}

export interface DeviceWebhookRoute {
  endpointId: string
  endpointName: string
  eventTypes: DeviceWebhookEventType[]
}

export interface PageMeta {
  limit: number
  offset: number
  total: number
}

export interface WebhookListParams {
  limit?: number
  offset?: number
  order?: "asc" | "desc"
}

export interface WebhookDeliveryListParams extends WebhookListParams {
  status?: WebhookDeliveryStatus
}

const enc = encodeURIComponent

export async function listWebhooks(
  params: WebhookListParams = {}
): Promise<{ webhooks: WebhookEndpoint[]; page: PageMeta }> {
  return xg().request("GET", "/webhooks", { query: { ...params } })
}

export async function createWebhook(body: {
  name: string
  url: string
  description?: string | null
}): Promise<{ webhook: WebhookEndpoint; secret: string }> {
  return xg().request("POST", "/webhooks", { body })
}

export async function getWebhook(
  id: string
): Promise<{ webhook: WebhookEndpointDetail }> {
  return xg().request("GET", `/webhooks/${enc(id)}`)
}

export async function updateWebhook(
  id: string,
  body: Partial<Pick<WebhookEndpoint, "name" | "url" | "description" | "enabled">>
): Promise<{ webhook: WebhookEndpoint }> {
  return xg().request("PATCH", `/webhooks/${enc(id)}`, { body })
}

export async function deleteWebhook(id: string): Promise<void> {
  await xg().request<void>("DELETE", `/webhooks/${enc(id)}`)
}

export async function testWebhook(
  id: string
): Promise<{ eventId: string; dispatched: boolean }> {
  return xg().request("POST", `/webhooks/${enc(id)}/test`)
}

export async function rotateWebhookSecret(id: string): Promise<{
  webhook: WebhookEndpoint
  secret: string
  previousSecretValidForHours: number
}> {
  return xg().request("POST", `/webhooks/${enc(id)}/rotate-secret`)
}

export async function listWebhookDeliveries(
  id: string,
  params: WebhookDeliveryListParams = {}
): Promise<{ deliveries: WebhookDelivery[]; page: PageMeta }> {
  return xg().request("GET", `/webhooks/${enc(id)}/deliveries`, {
    query: { ...params },
  })
}

export async function getWebhookDelivery(
  id: string,
  deliveryId: string
): Promise<{ delivery: WebhookDeliveryDetail }> {
  return xg().request("GET", `/webhooks/${enc(id)}/deliveries/${enc(deliveryId)}`)
}

export async function redeliverWebhook(
  id: string,
  deliveryId: string
): Promise<{ delivery: WebhookDelivery; enqueued: boolean }> {
  return xg().request(
    "POST",
    `/webhooks/${enc(id)}/deliveries/${enc(deliveryId)}/redeliver`
  )
}

export async function getDeviceWebhooks(
  deviceId: string
): Promise<{ routes: DeviceWebhookRoute[] }> {
  return xg().request("GET", `/devices/${enc(deviceId)}/webhooks`)
}

export async function setDeviceWebhooks(
  deviceId: string,
  routes: { endpointId: string; eventTypes: DeviceWebhookEventType[] }[]
): Promise<{ routes: DeviceWebhookRoute[] }> {
  return xg().request("PUT", `/devices/${enc(deviceId)}/webhooks`, {
    body: { routes },
  })
}

const DISABLED_REASON: Record<string, string> = {
  manual: "Disabled",
  gone: "Disabled (410 Gone)",
}

/** "Disabled" or "Disabled (410 Gone)", from `disabledReason`. */
export function disabledLabel(endpoint: WebhookEndpoint): string {
  return DISABLED_REASON[endpoint.disabledReason ?? ""] ?? "Disabled"
}

/**
 * nodeId -> the `webhook` endpoint name of each output.event node that has
 * one, from a run's (or template's) graph.
 */
export function nodeWebhookNames(
  definition: { nodes: { id: string; type: string; data: { config: Record<string, unknown> } }[] } | null | undefined
): Map<string, string> {
  const out = new Map<string, string>()
  for (const node of definition?.nodes ?? []) {
    if (node.type !== "output.event") continue
    const name = node.data.config.webhook
    if (typeof name === "string" && name.trim() !== "") out.set(node.id, name.trim())
  }
  return out
}

/** The host of an endpoint URL, for tables; the raw string if it won't parse. */
export function urlHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
