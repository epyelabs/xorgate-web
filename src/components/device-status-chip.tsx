import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { deviceStatusChipModel } from "@/lib/device-status"

/**
 * The status LED as a header chip: a dot in the LED's colour plus the state's
 * name ("Network recovering"), with the active health flags (the "why") in the
 * tooltip. Fed from `system.led_state` / `system.health_flags`: the live
 * `latest` in the device header, the replay `latest` at the playhead.
 *
 * Renders nothing while the device is healthy, offline, or has not reported a
 * code: like the throttle bolt beside it, it is an exception marker, not a
 * permanent badge (plan §6 Q4).
 */
export function DeviceStatusChip({
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
  const model = deviceStatusChipModel({ ledState, healthFlags, online })
  if (!model) return null
  const why = model.flags.length ? model.flags.join(", ") : "no flags set"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={className}
          data-testid="device-status-chip"
          data-code={model.code}
          aria-label={`Device status: ${model.label} (${why})`}
        >
          <span
            aria-hidden
            className="inline-block size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: model.color }}
          />
          {model.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">Device status: {model.label}</span>
          {model.flags.length ? (
            <ul className="list-disc pl-4">
              {model.flags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          ) : (
            <span className="opacity-80">No health flags set</span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
