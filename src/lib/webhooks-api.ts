import type { DeviceWebhookEventType, WebhookEndpoint } from "@xorgate/sdk"

// Webhooks (plans/xorgate-webhooks, Phase 4). Requests go through the SDK
// (`xg().webhooks`, `xg().devices.webhooks`, @xorgate/sdk 0.9.0); this module
// holds the console's labels, groups and pure helpers.
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

// Wire types come from @xorgate/sdk (0.9.0+), which owns the webhooks
// resource; this module keeps only the console's own helpers.
export type {
  DeviceWebhookEventType,
  DeviceWebhookRoute,
  WebhookDelivery,
  WebhookDeliveryDetail,
  WebhookDeliveryStatus,
  WebhookEndpoint,
  WebhookEndpointDetail,
  WebhookEventType,
  ListWebhookDeliveriesParams as WebhookDeliveryListParams,
} from "@xorgate/sdk"
const DISABLED_REASON: Record<string, string> = {
  manual: "Disabled",
  gone: "Disabled (410 Gone)",
  failing: "Disabled (kept failing)",
}

/** "Disabled", "Disabled (410 Gone)" or "Disabled (kept failing)", from `disabledReason`. */
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
