import type { Device } from "@xorgate/sdk"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { NamespaceStatus } from "@/lib/device-config-status"
import {
  formatScenarioStats,
  HOST_STATE_LABELS,
  storedSimulationConfig,
} from "@/lib/device-simulation"
import { useDeviceSimulation, useSimulationScenarios } from "@/queries/simulations"
import { InfoRow } from "../info-row"
import { ConfigStatusBadge, ConfigStatusCallout } from "./config-status"
import { formatTimestamp } from "./shared"

/**
 * Read-only: what a simulated device replays and what its host last said. The
 * scenario is switched from the reboot dialog (README Q5); loop and gap are API
 * settings this card only shows.
 */
export function SimulationCard({
  device,
  status,
}: {
  device: Device
  status: NamespaceStatus
}) {
  const simQuery = useDeviceSimulation(device.id, {
    fast: device.status !== "online",
  })
  const sim = simQuery.data ?? null
  const catalog = useSimulationScenarios()
  const stored = storedSimulationConfig(device.config)
  const scenarioId = stored?.scenarioId ?? sim?.scenarioId ?? null
  const scenario = catalog.data?.scenarios.find((s) => s.id === scenarioId)

  return (
    <Card data-testid="simulation-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Simulation
          <ConfigStatusBadge status={status} />
        </CardTitle>
        <CardDescription>
          This device is simulated: the device agent replaying a recorded drive
          in a hosted container. Switch scenario with Reboot.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ConfigStatusCallout status={status} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm lg:grid-cols-3">
          <InfoRow
            label="Scenario"
            title={scenarioId ?? undefined}
            value={
              // The title, not the id: skeleton while the catalog loads, the
              // id only once the lookup has actually failed or misses it.
              catalog.isPending ? (
                <Skeleton className="h-4 w-32" />
              ) : (
                <span data-testid="simulation-scenario" data-scenario-id={scenarioId ?? ""}>
                  {scenario?.title ?? scenarioId ?? "—"}
                </span>
              )
            }
          />
          <InfoRow
            label="Lap"
            value={scenario ? formatScenarioStats(scenario) || "—" : "—"}
          />
          <InfoRow
            label="Loop"
            value={stored === null ? "—" : stored.loop ? "On" : "Off (parks after one lap)"}
          />
          <InfoRow
            label="Gap between laps"
            value={stored === null ? "—" : `${stored.gapSeconds} s`}
          />
          <InfoRow
            label="Host state"
            title={sim?.hostMessage ?? undefined}
            value={
              sim === null ? (
                <Skeleton className="h-4 w-20" />
              ) : (
                <Badge
                  variant={sim.hostState === "error" ? "destructive" : "outline"}
                  data-testid="simulation-host-state-card"
                  data-host-state={sim.hostState}
                >
                  {HOST_STATE_LABELS[sim.hostState]}
                </Badge>
              )
            }
          />
          <InfoRow
            label="Host reported"
            value={sim?.hostReportedAt ? formatTimestamp(sim.hostReportedAt) : "—"}
          />
        </dl>
        {sim?.hostMessage ? (
          <p className="text-xs text-muted-foreground" data-testid="simulation-host-message">
            {sim.hostId ? `${sim.hostId}: ` : ""}
            {sim.hostMessage}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
