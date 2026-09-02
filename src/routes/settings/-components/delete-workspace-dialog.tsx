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
import type { Workspace } from "@xorgate/sdk"
import { xgMessage } from "@/lib/xorgate"
import { useWorkspaceStore } from "@/store/workspace"

export function DeleteWorkspaceDialog({
  open,
  onOpenChange,
  workspace,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspace: Workspace | null
}) {
  const [deleting, setDeleting] = useState(false)

  async function handleConfirm() {
    if (!workspace) return
    setDeleting(true)
    try {
      await useWorkspaceStore.getState().deleteWorkspace(workspace.id)
      toast.success(`Workspace "${workspace.name}" deleted`)
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
          <DialogTitle>Delete workspace</DialogTitle>
          <DialogDescription>
            This permanently deletes{" "}
            <span className="font-medium text-foreground">
              {workspace?.name}
            </span>{" "}
            and every device in it — recorded video, telemetry history,
            live-video channels and cloud identities included. This action
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
            {deleting ? "Deleting..." : "Delete workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
