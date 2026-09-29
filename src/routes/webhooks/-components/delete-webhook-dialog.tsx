import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { xg, xgMessage } from "@/lib/xorgate"
import type { WebhookEndpoint } from "@/lib/webhooks-api"

export function DeleteWebhookDialog({
  open,
  onOpenChange,
  endpoint,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  endpoint: WebhookEndpoint
  onDeleted: () => void
}) {
  const [deleting, setDeleting] = useState(false)

  async function handleConfirm() {
    setDeleting(true)
    try {
      await xg().webhooks.delete(endpoint.id)
      toast.success(`Endpoint "${endpoint.name}" deleted`)
      onOpenChange(false)
      onDeleted()
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={deleting ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete webhook endpoint</DialogTitle>
          <DialogDescription>
            This deletes{" "}
            <span className="font-mono font-medium text-foreground">{endpoint.name}</span>,
            its device routes, its delivery log and its signing secret. Workflow
            nodes that name it stop delivering (their events are recorded as
            unrouted) until an endpoint with that name exists again.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={deleting}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={handleConfirm} disabled={deleting}>
            {deleting ? "Deleting..." : "Delete endpoint"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
