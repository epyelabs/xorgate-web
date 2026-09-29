import { Link } from "@tanstack/react-router"
import { WebhookIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { RunEvent, RunMode } from "@/lib/workflow-run-schemas"
import { useWebhookEndpoints } from "@/queries/webhooks"

/**
 * Where an event's webhook goes (plans/xorgate-webhooks, Phase 4). A simulation
 * run never delivers; its events carry `wouldDeliverTo` (the node's name),
 * shown as "would deliver to x". A production run's event was routed by its
 * node's `webhook` name in the run's definition snapshot, shown as "routed to
 * x" with a link to that endpoint's delivery log. Either way, a name the
 * organization has no endpoint for reads "(no such endpoint)": the platform
 * records such events as unrouted and delivers nothing.
 */
export function WebhookTargetBadge({
  event,
  mode,
  names,
  link = true,
}: {
  event: Pick<RunEvent, "nodeId" | "wouldDeliverTo">
  mode: RunMode
  /** From nodeWebhookNames(run.definition). */
  names: Map<string, string>
  /** Off inside another interactive element (an accordion trigger button). */
  link?: boolean
}) {
  const endpointsQuery = useWebhookEndpoints()
  const name =
    mode === "simulation"
      ? (event.wouldDeliverTo ??
        (event.nodeId ? names.get(event.nodeId) : undefined) ??
        null)
      : event.nodeId
        ? (names.get(event.nodeId) ?? null)
        : null
  // Wait for the endpoint list: until it answers, "routed to x" could be a
  // claim the "(no such endpoint)" suffix is about to contradict.
  if (!name || endpointsQuery.isPending) return null

  const endpoint = endpointsQuery.data?.items.find((e) => e.name === name)
  const missing = endpointsQuery.isSuccess && !endpoint
  const verb = mode === "simulation" ? "would deliver to" : "routed to"

  const badge = (
    <Badge
      variant="outline"
      className={
        missing
          ? "shrink-0 gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400"
          : "shrink-0 gap-1"
      }
      data-testid="webhook-target-badge"
    >
      <WebhookIcon className="size-3" />
      <span>
        {verb} <span className="font-mono">{name}</span>
        {missing ? " (no such endpoint)" : null}
        {endpoint && !endpoint.enabled ? " (disabled)" : null}
      </span>
    </Badge>
  )

  const tip =
    mode === "simulation"
      ? missing
        ? `Simulations never deliver. In a production run this event would be recorded as unrouted: the organization has no endpoint named "${name}".`
        : `Simulations never deliver. In a production run this event is POSTed to "${name}" once the run ends.`
      : missing
        ? `Not delivered: the organization has no endpoint named "${name}", so the event was recorded as unrouted.`
        : `Queued for "${name}" when the run ended. The endpoint's delivery log has the outcome.`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {endpoint && link ? (
          <Link
            to="/webhooks/$id"
            params={{ id: endpoint.id }}
            onClick={(e) => e.stopPropagation()}
          >
            {badge}
          </Link>
        ) : (
          <span>{badge}</span>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{tip}</TooltipContent>
    </Tooltip>
  )
}
