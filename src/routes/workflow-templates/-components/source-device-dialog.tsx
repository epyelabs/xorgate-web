import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { WindowPicker } from "@/components/recordings-list"
import type { Device } from "@/lib/api"
import type { ManualWindow } from "@/lib/device-workflow-schemas"
import { DeviceRadioList } from "./device-radio-list"
import { deviceLabel, type SourceBinding } from "./simulator-types"

const DEFAULT_WINDOW: ManualWindow = { mode: "lastN", n: 100 }

// "Select Device" for a sensor source (GPS / IMU / telemetry): pick a device and
// the telemetry window to pull. Confirms into a `device-telemetry` binding.
export function SourceDeviceDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (
    binding: Extract<SourceBinding, { kind: "device-telemetry" }>,
  ) => void
}) {
  const [device, setDevice] = useState<Device | null>(null)
  const [window, setWindow] = useState<ManualWindow>(DEFAULT_WINDOW)

  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setDevice(null)
    setWindow(DEFAULT_WINDOW)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open])

  const windowValid =
    window.mode === "range" ? window.from !== "" && window.to !== "" : window.n > 0
  const canConfirm = !!device && windowValid

  const handleConfirm = () => {
    if (!device) return
    onConfirm({
      kind: "device-telemetry",
      deviceId: device.id,
      deviceName: deviceLabel(device),
      window,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Select device</DialogTitle>
          <DialogDescription>
            Pick a device and the telemetry window to feed this sensor source.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Device</span>
            <DeviceRadioList
              active={open}
              selectedId={device?.id ?? null}
              onSelect={setDevice}
            />
          </div>

          {device ? (
            <WindowPicker value={window} onChange={setWindow} unit="readings" />
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!canConfirm}>
            Use device
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
