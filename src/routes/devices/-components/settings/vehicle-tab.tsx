import type { Device } from "@xorgate/sdk"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { DeviceSettingsPatch } from "@/hooks/use-device-settings"
import type { DeviceConfigStatus } from "@/lib/device-config-status"
import { obdCapability } from "@/lib/device-obd"
import { useDeviceModel } from "@/queries/devices"
import { SettingsCallout } from "./callout"
import { ObdAdapterCard } from "./obd-adapter-card"
import { ObdCard } from "./obd-card"

/**
 * Settings > Vehicle (obd2-bluetooth-integration, plan section 9 stages 3,
 * 6, 7 and 9): the `obd` namespace beside the adapter's reported state.
 *
 * Gated on the MODEL, not the device: the API refuses the `obd` namespace
 * for a model without `peripherals.obd` (400), and an agent on such a model
 * reports no `effective.obd` at all, so neither card has anything honest to
 * show there. A model that declares no vehicle gets one plain line instead
 * of controls that would bounce.
 */
export function VehicleTab({
  device,
  configStatus,
  isPending,
  commit,
  pollReport,
  refreshReport,
  refreshing,
}: {
  device: Device
  configStatus: DeviceConfigStatus
  isPending: (key: string) => boolean
  commit: (key: string, patch: DeviceSettingsPatch) => void
  pollReport: (done: (device: Device) => boolean, maxTicks?: number) => Promise<boolean>
  refreshReport: () => void
  refreshing: boolean
}) {
  const modelQuery = useDeviceModel(device.deviceModelId)
  const model = modelQuery.data ?? null
  const obd = obdCapability(model?.ioCapabilities)

  if (modelQuery.isPending) return <Skeleton className="h-40 w-full" />

  if (obd === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Vehicle OBD-II</CardTitle>
          <CardDescription>
            Vehicle data read through an OBD-II adapter on the diagnostic port.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsCallout>
            {model === null
              ? "This device's model could not be loaded, so its vehicle capability is unknown."
              : `${model.name} does not declare an OBD-II adapter, so there is nothing to set up here. ` +
                "Vehicle readings need a model whose capabilities include peripherals.obd."}
          </SettingsCallout>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {/* The desired half and the reported half of one question — which
          adapter is this device on, and is it talking to the vehicle — read
          together, like the SIM and APN pair on Connectivity. They stack below
          `lg`, where a half-width card would squeeze the candidate list. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ObdCard
          device={device}
          capability={obd}
          configStatus={configStatus}
          isPending={isPending}
          commit={commit}
          pollReport={pollReport}
        />
        <ObdAdapterCard device={device} onRefresh={refreshReport} refreshing={refreshing} />
      </div>
    </div>
  )
}
