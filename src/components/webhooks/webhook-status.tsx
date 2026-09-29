import { Badge } from "@/components/ui/badge"
import {
  disabledLabel,
  type WebhookDeliveryStatus,
  type WebhookEndpoint,
} from "@/lib/webhooks-api"

export function EndpointStateBadge({ endpoint }: { endpoint: WebhookEndpoint }) {
  if (!endpoint.enabled)
    return <Badge variant="destructive">{disabledLabel(endpoint)}</Badge>
  return <Badge variant="secondary">Enabled</Badge>
}

const DELIVERY_LABEL: Record<WebhookDeliveryStatus, string> = {
  pending: "Pending",
  delivered: "Delivered",
  failed: "Failed",
  exhausted: "Exhausted",
}

export function DeliveryStatusBadge({ status }: { status: WebhookDeliveryStatus }) {
  const variant =
    status === "delivered"
      ? "secondary"
      : status === "pending"
        ? "outline"
        : "destructive"
  return (
    <Badge variant={variant} data-testid={`delivery-status-${status}`}>
      {DELIVERY_LABEL[status]}
    </Badge>
  )
}
