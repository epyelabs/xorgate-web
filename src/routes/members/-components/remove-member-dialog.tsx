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
import type { MembershipWithUser } from "@xorgate/sdk"
import { xg, xgMessage } from "@/lib/xorgate"

export function RemoveMemberDialog({
  open,
  onOpenChange,
  member,
  onRemoved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: MembershipWithUser | null
  onRemoved: () => void
}) {
  const [removing, setRemoving] = useState(false)

  const label = member?.user?.name || member?.user?.email || "this member"

  async function handleConfirm() {
    if (!member) return
    setRemoving(true)
    try {
      await xg().memberships.remove(member.id)
      toast.success(`Removed ${label}`)
      onRemoved()
      onOpenChange(false)
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={removing ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove member</DialogTitle>
          <DialogDescription>
            This removes{" "}
            <span className="font-medium text-foreground">{label}</span> from the
            organization. They immediately lose access to its workspaces and
            devices. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={removing}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={removing}
          >
            {removing ? "Removing..." : "Remove member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
