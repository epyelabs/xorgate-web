import { InfoIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { DeviceStatusKeyList } from "@/components/device-status-info"

/**
 * Info icon button that opens the device status colour key. Kept mounted (but
 * invisible and inert) while the overlay is off so toggling never reflows the
 * control row.
 */
export function DeviceStatusKeyButton({
  visible,
  source,
}: {
  visible: boolean
  source: "insight" | "overview" | null
}) {
  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Device status colours"
              aria-hidden={!visible}
              tabIndex={visible ? 0 : -1}
              className={cn(!visible && "invisible")}
              data-testid="device-status-key-button"
            >
              <InfoIcon className="size-3.5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Device status colours</TooltipContent>
      </Tooltip>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Device status colours</DialogTitle>
          <DialogDescription>
            The scrubber shows the status LED&apos;s state over the replay in
            the LED&apos;s own colours.
          </DialogDescription>
        </DialogHeader>
        <DeviceStatusKeyList source={source} />
      </DialogContent>
    </Dialog>
  )
}
