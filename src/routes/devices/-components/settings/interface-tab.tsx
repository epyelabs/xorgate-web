import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Device } from "@xorgate/sdk"
import type { ActiveStreamsViewType } from "@/lib/xorgate"
import type { DeviceSettingsPatch } from "@/hooks/use-device-settings"
import { DEFAULT_IMU_VIEW } from "@/lib/device-config-defaults"
import { SettingsCallout } from "./callout"
import { parseAngle } from "./shared"

const VIEW_TYPE_KEY = "device-view-type"
const IMU_VIEW_KEY = "device-imu-view"

const VIEW_TYPE_OPTIONS: { value: ActiveStreamsViewType; label: string }[] = [
  { value: "card", label: "Card view (default)" },
  { value: "map", label: "Map view" },
]

export function InterfaceTab({
  device,
  isPending,
  commit,
}: {
  device: Device
  isPending: (key: string) => boolean
  commit: (key: string, patch: DeviceSettingsPatch) => void
}) {
  const view = device.uiPrefs.imuView ?? DEFAULT_IMU_VIEW
  // Angle inputs are strings so partial numeric input ("-", "1.") never fights
  // the user; parsed on blur, re-seeded from the device (which is also how a
  // failed save and the backend's elevation clamp snap the fields back).
  const [azimuth, setAzimuth] = useState(String(view.azimuthDeg))
  const [elevation, setElevation] = useState(String(view.elevationDeg))
  useEffect(() => {
    setAzimuth(String(view.azimuthDeg))
    setElevation(String(view.elevationDeg))
  }, [view.azimuthDeg, view.elevationDeg])

  function commitImuView() {
    const azimuthDeg = parseAngle(azimuth)
    const elevationDeg = parseAngle(elevation)
    if (azimuthDeg === null || elevationDeg === null) {
      toast.error("Camera angles must be numbers (degrees)")
      setAzimuth(String(view.azimuthDeg))
      setElevation(String(view.elevationDeg))
      return
    }
    if (azimuthDeg === view.azimuthDeg && elevationDeg === view.elevationDeg) {
      // Snap inputs back to canonical form (e.g. "045" -> "45").
      setAzimuth(String(view.azimuthDeg))
      setElevation(String(view.elevationDeg))
      return
    }
    commit(IMU_VIEW_KEY, { imuView: { azimuthDeg, elevationDeg } })
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <SettingsCallout>
        <span className="font-medium text-foreground">Display only.</span>{" "}
        Nothing on this tab is sent to the device — these settings change how
        the app shows this device to you, and take effect the next time you open
        the tab they apply to.
      </SettingsCallout>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Active Streams</CardTitle>
            <CardDescription>
              How the Active Streams tab opens for this device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={VIEW_TYPE_KEY}>
                  Default stream view
                </FieldLabel>
                <Select
                  value={device.uiPrefs.activeStreamsViewType ?? "card"}
                  disabled={isPending(VIEW_TYPE_KEY)}
                  onValueChange={(v) =>
                    commit(VIEW_TYPE_KEY, {
                      activeStreamsViewType: v as ActiveStreamsViewType,
                    })
                  }
                >
                  <SelectTrigger id={VIEW_TYPE_KEY}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VIEW_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Layout for the Active Streams tab. Saved automatically.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Orientation view camera</CardTitle>
            <CardDescription>
              Where the camera sits in the 3D orientation view on the Streams
              tab.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel>Camera angle (degrees)</FieldLabel>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">
                      Azimuth
                    </span>
                    <Input
                      id="device-imu-view-azimuth"
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={azimuth}
                      disabled={isPending(IMU_VIEW_KEY)}
                      onChange={(e) => setAzimuth(e.target.value)}
                      onBlur={commitImuView}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">
                      Elevation
                    </span>
                    <Input
                      id="device-imu-view-elevation"
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={elevation}
                      disabled={isPending(IMU_VIEW_KEY)}
                      onChange={(e) => setElevation(e.target.value)}
                      onBlur={commitImuView}
                    />
                  </div>
                </div>
                <FieldDescription>
                  Azimuth spins the camera around the box (0 = behind, 90 =
                  right side); elevation raises it toward top-down (clamped to
                  ±85). Default: 45 / 24. Saved automatically.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
