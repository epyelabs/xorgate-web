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
import { ApiError, removeMembership, type OrgMember } from "@/lib/api"

export function RemoveMemberDialog({
  open,
  onOpenChange,
  member,
  onRemoved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: OrgMember | null
  onRemoved: () => void
}) {
  const [removing, setRemoving] = useState(false)

  const label = member?.user?.name || member?.user?.email || "this member"

  async function handleConfirm() {
    if (!member) return
    setRemoving(true)
    try {
      await removeMembership(member.id)
      toast.success(`Removed ${label}`)
      onRemoved()
      onOpenChange(false)
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : (err as Error).message ?? "Failed to remove member"
      toast.error(message)
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
