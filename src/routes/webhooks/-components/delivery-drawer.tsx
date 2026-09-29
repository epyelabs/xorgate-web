import { RotateCcwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { JsonTree } from "@/components/json-tree"
import { Fact, FactGrid } from "@/components/models/facts"
import { DeliveryStatusBadge } from "@/components/webhooks/webhook-status"
import { xgMessage } from "@/lib/xorgate"
import type { WebhookDelivery } from "@/lib/webhooks-api"
import { useWebhookDelivery } from "@/queries/webhooks"

const at = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString() : null

// One delivery: the attempt bookkeeping, the receiver's answer (first 1 KB of
// the body, or the transport error) and the envelope exactly as it was sent.
export function DeliveryDrawer({
  endpointId,
  deliveryId,
  onOpenChange,
  canRedeliver,
  onRedeliver,
}: {
  endpointId: string
  deliveryId: string | null
  onOpenChange: (open: boolean) => void
  canRedeliver: boolean
  onRedeliver: (delivery: WebhookDelivery) => void
}) {
  const query = useWebhookDelivery(endpointId, deliveryId)
  const d = query.data?.delivery

  return (
    <Sheet open={deliveryId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="delivery-drawer">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono">{d?.event?.type ?? d?.eventType ?? "Delivery"}</span>
            {d ? <DeliveryStatusBadge status={d.status} /> : null}
          </SheetTitle>
          <SheetDescription className="font-mono text-[11px]">
            delivery {deliveryId}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4">
          {query.error ? (
            <p className="text-sm text-destructive">{xgMessage(query.error)}</p>
          ) : !d ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              <FactGrid columns={2}>
                <Fact label="Attempt" value={`${d.attempt} of 8`} />
                <Fact label="Response" value={d.responseStatus ?? null} hint={d.responseMs != null ? `${d.responseMs} ms` : undefined} />
                <Fact label="Created" value={at(d.createdAt)} />
                <Fact label="Delivered" value={at(d.deliveredAt)} />
                {d.status === "pending" ? (
                  <Fact label="Next attempt" value={at(d.nextAttemptAt)} />
                ) : null}
                <Fact label="webhook-id" value={d.eventId} mono span />
                {d.redeliveryOf ? (
                  <Fact label="Redelivery of" value={d.redeliveryOf} mono span />
                ) : null}
              </FactGrid>
              {d.error ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {d.error}
                </div>
              ) : null}
              <div className="flex flex-col gap-1">
                <p className="text-[10px] tracking-wider text-muted-foreground uppercase">
                  Response body (first 1 KB)
                </p>
                <pre className="max-h-40 overflow-auto rounded-md border border-border bg-muted/40 px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap">
                  {d.responseExcerpt || "(empty)"}
                </pre>
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-[10px] tracking-wider text-muted-foreground uppercase">
                  Event sent
                </p>
                <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
                  {d.event ? (
                    <JsonTree value={d.event} />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      The event has expired (kept 30 days).
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {d && canRedeliver ? (
          <SheetFooter>
            <Button variant="outline" onClick={() => onRedeliver(d)}>
              <RotateCcwIcon />
              Redeliver
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
