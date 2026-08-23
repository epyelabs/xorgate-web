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
import type { ApiKey } from "@xorgate/sdk"
import { xg, xgMessage } from "@/lib/xorgate"

export function DeleteApiKeyDialog({
  open,
  onOpenChange,
  apiKey,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  apiKey: ApiKey | null
  onDeleted: () => void
}) {
  const [deleting, setDeleting] = useState(false)

  async function handleConfirm() {
    if (!apiKey) return
    setDeleting(true)
    try {
      await xg().apiKeys.delete(apiKey.id)
      toast.success(`API key "${apiKey.name}" revoked`)
      onDeleted()
      onOpenChange(false)
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
          <DialogTitle>Revoke API key</DialogTitle>
          <DialogDescription>
            This permanently revokes{" "}
            <span className="font-medium text-foreground">{apiKey?.name}</span>.
            Any client using this key will immediately lose access. This action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={deleting}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={deleting}
          >
            {deleting ? "Revoking..." : "Revoke key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
