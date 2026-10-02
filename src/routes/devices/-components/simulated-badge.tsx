import { Badge } from "@/components/ui/badge"
import { simulationScenarioTitle } from "@/lib/device-simulation"
import { cn } from "@/lib/utils"
import { useSimulationScenarios } from "@/queries/simulations"

/**
 * Marks a device created as simulated (`device.simulated`, fixed at creation
 * server-side). Deliberately NOT keyed off the agent's reported mode: a sim
 * reports `replay`, and the mode is reported-only.
 *
 * Pass the device's `config` to also name the scenario it is configured for
 * ("Simulated · Short stop-and-go urban"). The catalog query is shared, so a
 * list of sims costs one request, not one per row.
 */
export function SimulatedBadge({
  config,
  className,
}: {
  config?: unknown
  className?: string
}) {
  const catalog = useSimulationScenarios({ enabled: config !== undefined })
  const scenario = simulationScenarioTitle(config, catalog.data?.scenarios)
  return (
    <Badge
      variant="outline"
      data-testid="simulated-badge"
      data-scenario-title={scenario ?? ""}
      title={
        scenario
          ? `Simulated device replaying "${scenario}": the device agent replaying a recorded drive, no hardware`
          : "Simulated device: the device agent replaying a recorded drive, no hardware"
      }
      className={cn(
        "max-w-full border-violet-500/50 text-violet-600 dark:text-violet-400",
        className
      )}
    >
      <span className="truncate">{scenario ? `Simulated · ${scenario}` : "Simulated"}</span>
    </Badge>
  )
}
