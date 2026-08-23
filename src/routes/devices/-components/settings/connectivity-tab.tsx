import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { Device, LteRecoveryConfig } from "@xorgate/sdk"
import type { DeviceConfigStatus } from "@/lib/device-config-status"
import { ConfigStatusBadge, ConfigStatusCallout } from "./config-status"
import type { DeviceSettingsPatch } from "@/hooks/use-device-settings"
import {
  DEFAULT_LTE_DEADZONE_PROFILE,
  DEFAULT_LTE_GPS_FIX_RESET_POLICY,
} from "@/lib/device-config-defaults"
import { SimCard } from "./sim-card"
import { ApnCard } from "./apn-card"

const GNSS_KEY = "device-gnss-ant-bias"
const GPS_FIX_RESET_KEY = "device-lte-gps-fix-reset-policy"
const DEADZONE_KEY = "device-lte-deadzone-profile"

// LTE recovery policy options (lte_gnss_recovery plan, R8). Labels describe
// the user-facing tradeoff; the preset numbers live in the field descriptions
// below and in the device daemon (deadzone_profile_params).
const GPS_FIX_RESET_POLICY_OPTIONS: {
  value: NonNullable<LteRecoveryConfig["gpsFixResetPolicy"]>
  label: string
}[] = [
  { value: "defer", label: "Protect position (default)" },
  { value: "veto-deadzone", label: "Never reset in a dead zone with a fix" },
]

const DEADZONE_PROFILE_OPTIONS: {
  value: NonNullable<LteRecoveryConfig["deadZoneProfile"]>
  label: string
}[] = [
  { value: "conservative", label: "Conservative" },
  { value: "balanced", label: "Balanced (default)" },
  { value: "aggressive", label: "Aggressive" },
]

export function ConnectivityTab({
  device,
  configStatus,
  isPending,
  commit,
  refreshReport,
  refreshing,
}: {
  device: Device
  configStatus: DeviceConfigStatus
  isPending: (key: string) => boolean
  commit: (key: string, patch: DeviceSettingsPatch) => void
  refreshReport: () => void
  refreshing: boolean
}) {
  const lteRecovery = device.config.lteRecovery ?? null

  // Spreading the stored object preserves knobs set out-of-band (xorgate set /
  // API); the backend persists it and delivers it as retained MQTT config,
  // which the modem daemon reads live at its next recovery decision.
  function commitLteRecovery(key: string, patch: Partial<LteRecoveryConfig>) {
    commit(key, { lteRecoveryConfig: { ...(lteRecovery ?? {}), ...patch } })
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>GPS antenna</CardTitle>
          <CardDescription>
            Power delivered to the antenna over the coaxial cable.
          </CardDescription>
          <CardAction>
            <ConfigStatusBadge status={configStatus.gnssAntBias} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={GNSS_KEY}>Power the GPS antenna</FieldLabel>
                <FieldDescription>
                  Off by default. Active GPS antennas have a built-in amplifier
                  that needs power over the antenna cable; turn this on only when
                  one is fitted. Keep it off for passive antennas.
                </FieldDescription>
              </FieldContent>
              <Switch
                id={GNSS_KEY}
                checked={device.config.gnssAntBias ?? false}
                disabled={isPending(GNSS_KEY)}
                onCheckedChange={(next) =>
                  commit(GNSS_KEY, { gnssAntBias: next })
                }
              />
            </Field>
            {/* The reported bias comes from the modem daemon's own telemetry,
                so this is the APPLIED state, not the requested one. */}
            <ConfigStatusCallout status={configStatus.gnssAntBias} />
          </FieldGroup>
        </CardContent>
      </Card>

      {/* The SIM and the APN are two halves of one question — which carrier is
          this device on, and is it dialling that carrier's gateway — so they sit
          side by side and are read together. They stack below `lg`, where a
          half-width card would squeeze the SIM's four values. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {/* Whether there is a SIM at all is the most basic fact about
            connectivity, and the one nothing else here can tell you. Read-only —
            you cannot set an ICCID, so there is no badge and no save. */}
        <SimCard device={device} onRefresh={refreshReport} refreshing={refreshing} />

        {/* Beside the SIM it identifies: the APN is the writable half of the
            same plan, and the one that can strand a device — see apn-card.tsx. */}
        <ApnCard
          device={device}
          configStatus={configStatus}
          isPending={isPending}
          commit={commit}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cellular recovery</CardTitle>
          <CardDescription>
            How the device recovers its cellular connection when it drops, and
            what that is allowed to cost the GPS fix.
          </CardDescription>
          <CardAction>
            <ConfigStatusBadge status={configStatus.lteRecovery} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={GPS_FIX_RESET_KEY}>
                Cellular recovery with a GPS fix
              </FieldLabel>
              <Select
                value={
                  lteRecovery?.gpsFixResetPolicy ??
                  DEFAULT_LTE_GPS_FIX_RESET_POLICY
                }
                disabled={isPending(GPS_FIX_RESET_KEY)}
                onValueChange={(v) =>
                  commitLteRecovery(GPS_FIX_RESET_KEY, {
                    gpsFixResetPolicy: v as NonNullable<
                      LteRecoveryConfig["gpsFixResetPolicy"]
                    >,
                  })
                }
              >
                <SelectTrigger id={GPS_FIX_RESET_KEY}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GPS_FIX_RESET_POLICY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                A full modem reset restarts GPS from scratch. Protect position:
                allow a reset only after 30+ minutes without cellular (default).
                Protect harder: never reset while parked out of coverage with a
                GPS fix. Applied by the device without a restart.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor={DEADZONE_KEY}>
                Out-of-coverage recovery pace
              </FieldLabel>
              <Select
                value={
                  lteRecovery?.deadZoneProfile ?? DEFAULT_LTE_DEADZONE_PROFILE
                }
                disabled={isPending(DEADZONE_KEY)}
                onValueChange={(v) =>
                  commitLteRecovery(DEADZONE_KEY, {
                    deadZoneProfile: v as NonNullable<
                      LteRecoveryConfig["deadZoneProfile"]
                    >,
                  })
                }
              >
                <SelectTrigger id={DEADZONE_KEY}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEADZONE_PROFILE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                How hard the device works to restore cellular in a dead zone.
                Conservative: gentle radio nudges (15 min–2 h), never a modem
                reset. Balanced (default): nudges 10–60 min apart, reset only
                after 3 failed radio cycles. Aggressive: nudges 10–20 min apart,
                reset after 1 failed cycle. Applied by the device without a
                restart.
              </FieldDescription>
            </Field>
            <ConfigStatusCallout status={configStatus.lteRecovery} />
          </FieldGroup>
        </CardContent>
      </Card>
    </div>
  )
}
