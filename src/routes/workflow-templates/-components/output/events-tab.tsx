import { DownloadIcon } from "lucide-react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { JsonTree } from "@/components/json-tree"
import { WebhookTargetBadge } from "@/components/webhooks/webhook-target-badge"
import { nodeWebhookNames } from "@/lib/webhooks-api"
import type { WorkflowRunDetail } from "@/lib/workflow-run-schemas"
import { downloadArtifact } from "./artifact-fetch"

// One accordion item per emitted event: header = kind, local time (ISO on
// hover), confidence; body = summary, the full payload as a tree, the clip
// key when the event carries evidence. An event whose node names a webhook
// endpoint carries a "would deliver to" badge (simulations never deliver).
export function EventsTab({ run }: { run: WorkflowRunDetail }) {
  const webhookNames = nodeWebhookNames(run.definition)
  if (run.events.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
        No events emitted for this run.
      </p>
    )
  }
  return (
    <Accordion type="multiple" className="flex flex-col" data-testid="events-tab">
      {run.events.map((ev) => {
        const at = new Date(ev.occurredAt)
        return (
          <AccordionItem key={ev.id} value={ev.id}>
            <AccordionTrigger className="py-1.5 hover:no-underline">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate font-mono text-xs text-foreground">{ev.kind}</span>
                <span
                  className="shrink-0 text-[11px] text-muted-foreground"
                  title={ev.occurredAt}
                >
                  {Number.isNaN(at.getTime()) ? ev.occurredAt : at.toLocaleString()}
                </span>
              </span>
              <WebhookTargetBadge
                event={ev}
                mode={run.mode}
                names={webhookNames}
                link={false}
              />
              <Badge variant="secondary" className="shrink-0">
                {ev.confidence.toFixed(2)}
              </Badge>
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-1.5 pb-2.5">
              {ev.payloadSummary ? (
                <p className="text-xs text-foreground">{ev.payloadSummary}</p>
              ) : null}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
                <dt>occurredAt</dt>
                <dd className="text-foreground/80">{ev.occurredAt}</dd>
                <dt>confidence</dt>
                <dd className="text-foreground/80">{ev.confidence}</dd>
                {ev.clip || ev.clipKey ? (
                  <>
                    <dt>clip</dt>
                    <dd className="flex items-center gap-1 text-foreground/80">
                      <span className="truncate">{ev.clipKey ?? "yes"}</span>
                      {ev.clipKey ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title="Download clip"
                          aria-label="Download clip"
                          onClick={() => void downloadArtifact(run.id, ev.clipKey!)}
                        >
                          <DownloadIcon className="size-3" />
                        </Button>
                      ) : null}
                    </dd>
                  </>
                ) : null}
              </dl>
              <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
                <p className="mb-0.5 text-[10px] text-muted-foreground">payload</p>
                {ev.payload === undefined ? (
                  <p className="text-[11px] text-muted-foreground">
                    Not included in this run detail (older backend); open
                    events.jsonl from the Data tab.
                  </p>
                ) : (
                  <JsonTree value={ev.payload} />
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        )
      })}
    </Accordion>
  )
}
