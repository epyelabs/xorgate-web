import { useEffect, useState } from "react"
import { RefreshCwIcon } from "lucide-react"
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
import { xgMessage } from "@/lib/xorgate"
import { useSimulationScenarios } from "@/queries/simulations"
import { ScenarioPicker } from "./scenario-picker"

/**
 * The reboot dialog for a SIMULATED device: the same confirm as
 * `RebootDeviceDialog`, plus "reboot into" a scenario (README Q5: the
 * `simulation` namespace + a plain reboot). A sibling rather than an option on
 * the real dialog so a real device's reboot stays exactly what it was.
 */
export function RebootSimulationDialog({
  open,
  onOpenChange,
  deviceName,
  currentScenarioId,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  deviceName: string
  currentScenarioId: string | null
  onConfirm: (scenarioId: string | null) => Promise<void> | void
}) {
  const [rebooting, setRebooting] = useState(false)
  const [pick, setPick] = useState<string | null>(currentScenarioId)
  const catalog = useSimulationScenarios({ enabled: open })

  // Every open starts from the scenario the device is on now.
  useEffect(() => {
    if (open) setPick(currentScenarioId)
  }, [open, currentScenarioId])

  async function handleConfirm() {
    setRebooting(true)
    try {
      await onConfirm(pick)
    } finally {
      setRebooting(false)
    }
  }

  const switching = pick !== null && pick !== currentScenarioId

  return (
    <Dialog open={open} onOpenChange={rebooting ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Reboot device</DialogTitle>
          <DialogDescription>
            This restarts the simulated device{" "}
            <span className="font-medium text-foreground">{deviceName}</span>.
            It goes offline for a few seconds and comes back on the scenario
            picked below.
          </DialogDescription>
        </DialogHeader>
        {catalog.error && !catalog.data ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <span>{xgMessage(catalog.error)}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void catalog.refetch()}
            >
              <RefreshCwIcon />
              Retry
            </Button>
          </div>
        ) : (
          <ScenarioPicker
            scenarios={catalog.data?.scenarios}
            loading={catalog.isPending}
            value={pick}
            currentId={currentScenarioId}
            onChange={setPick}
            disabled={rebooting}
          />
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={rebooting}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleConfirm} disabled={rebooting}>
            {rebooting
              ? "Rebooting..."
              : switching
                ? "Reboot into scenario"
                : "Reboot device"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
