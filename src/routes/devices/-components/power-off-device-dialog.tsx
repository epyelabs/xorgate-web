import { useState } from "react"
import { TriangleAlertIcon } from "lucide-react"
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

// Deliberately heavier than RebootDeviceDialog: a reboot comes back on its own,
// a power-off does not. The callout spells out that recovery needs someone
// physically present, and the confirm button is destructive-styled.
export function PowerOffDeviceDialog({
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
  const [poweringOff, setPoweringOff] = useState(false)

  async function handleConfirm() {
    setPoweringOff(true)
    try {
      await onConfirm()
    } finally {
      setPoweringOff(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={poweringOff ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Power off device</DialogTitle>
          <DialogDescription>
            This shuts down{" "}
            <span className="font-medium text-foreground">{deviceName}</span>. It
            will stop streaming and reporting telemetry immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              You cannot power it back on remotely.
            </span>{" "}
            The device stays off until someone physically restores power to it.
          </p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={poweringOff}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={poweringOff}
          >
            {poweringOff ? "Powering off..." : "Power off device"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
