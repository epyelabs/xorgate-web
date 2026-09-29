import { useEffect, useState } from "react"
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
import { SecretReveal } from "@/components/webhooks/secret-reveal"
import { xgMessage } from "@/lib/xorgate"
import { rotateWebhookSecret, type WebhookEndpoint } from "@/lib/webhooks-api"

// Rotation keeps the previous secret valid for a window (24 h): deliveries
// carry two `v1,` signatures meanwhile, so the receiver can switch at its own
// pace. The new secret is shown once.
export function RotateSecretDialog({
  open,
  onOpenChange,
  endpoint,
  onRotated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  endpoint: WebhookEndpoint
  onRotated: () => void
}) {
  const [rotating, setRotating] = useState(false)
  const [result, setResult] = useState<{ secret: string; hours: number } | null>(null)

  useEffect(() => {
    if (open) return
    const t = setTimeout(() => setResult(null), 200)
    return () => clearTimeout(t)
  }, [open])

  async function handleConfirm() {
    setRotating(true)
    try {
      const res = await rotateWebhookSecret(endpoint.id)
      setResult({ secret: res.secret, hours: res.previousSecretValidForHours })
      onRotated()
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setRotating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={rotating ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rotate signing secret</DialogTitle>
          <DialogDescription>
            {result
              ? `The new secret for ${endpoint.name}.`
              : `Issues a new secret for ${endpoint.name}. The current one keeps verifying for 24 hours: deliveries carry both signatures until then.`}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="flex flex-col gap-4">
            <SecretReveal
              secret={result.secret}
              note={`The previous secret stays valid for ${result.hours} hours.`}
            />
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={rotating}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={handleConfirm} disabled={rotating}>
              {rotating ? "Rotating..." : "Rotate secret"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
