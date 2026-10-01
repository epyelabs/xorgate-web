import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * Marks a device created as simulated (`device.simulated`, fixed at creation
 * server-side). Deliberately NOT keyed off the agent's reported mode: a sim
 * reports `replay`, and the mode is reported-only.
 */
export function SimulatedBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      data-testid="simulated-badge"
      title="Simulated device: the device agent replaying a recorded drive, no hardware"
      className={cn(
        "border-violet-500/50 text-violet-600 dark:text-violet-400",
        className
      )}
    >
      Simulated
    </Badge>
  )
}
