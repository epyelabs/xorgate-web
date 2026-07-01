import { useState } from "react"
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

export function RebootDeviceDialog({
  open,
  onOpenChange,
  deviceName,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  deviceName: string
  onConfirm: () => Promise<void> | void
}) {
  const [rebooting, setRebooting] = useState(false)

  async function handleConfirm() {
    setRebooting(true)
    try {
      await onConfirm()
    } finally {
      setRebooting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={rebooting ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reboot device</DialogTitle>
          <DialogDescription>
            This restarts{" "}
            <span className="font-medium text-foreground">{deviceName}</span>. It
            will disconnect and stop streaming for a short while as it comes back
            online.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={rebooting}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleConfirm} disabled={rebooting}>
            {rebooting ? "Rebooting..." : "Reboot device"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
