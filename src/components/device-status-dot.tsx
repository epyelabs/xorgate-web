import { useContext } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
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
import {
  deviceStatusDotModel,
  type DeviceStatusDotModel,
} from "@/lib/device-status"
import { DeviceStatusDetail } from "@/components/device-status-info"
import { DeviceStatusSourceContext } from "@/lib/device-status-context"

/** The shared "Device status" dialog body (System card dot + header chip). */
export function DeviceStatusDialogContent({
  model,
}: {
  model: DeviceStatusDotModel
}) {
  const source = useContext(DeviceStatusSourceContext)
  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Device status</DialogTitle>
      </DialogHeader>
      <DeviceStatusDetail model={model} source={source} />
    </DialogContent>
  )
}

/**
 * The status LED as a coloured dot beside the System card's title (plan §7
 * R1b): the LED's colour for the current `system.led_state` (green while
 * healthy), no text. Click opens the state, its meaning and the reported
 * faults and the colour key. Renders nothing while the device is offline or has no reading.
 * Live feeds it the live `latest`, replay the `latest` at the playhead.
 */
export function DeviceStatusDot({
  ledState,
  healthFlags,
  online,
  className,
}: {
  ledState?: number | null
  healthFlags?: number | null
  online: boolean
  className?: string
}) {
  const model = deviceStatusDotModel({ ledState, healthFlags, online })
  if (!model) return null
  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Device status"
              data-testid="device-status-dot"
              data-code={model.code}
              className={cn("cursor-pointer", className)}
            >
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-full ring-1 ring-foreground/10"
                style={{ backgroundColor: model.color }}
              />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>{model.label}</TooltipContent>
      </Tooltip>
      <DeviceStatusDialogContent model={model} />
    </Dialog>
  )
}
