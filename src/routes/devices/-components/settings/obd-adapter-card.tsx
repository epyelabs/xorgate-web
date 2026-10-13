import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  RefreshCwIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { Device } from "@xorgate/sdk"
import {
  OBD_LINK_LABELS,
  obdProfileSummary,
  obdStatusDisplay,
  reportedObd,
  type ObdStatusDisplay,
} from "@/lib/device-obd"
import { cn } from "@/lib/utils"
import { InfoRow } from "../info-row"
import { SettingsCallout } from "./callout"
import { formatTimestamp } from "./shared"

/**
 * The OBD adapter as the device reports it (plan section 9 stage 6, "trust
 * and audit"): the collector's state, the link code, the probed bus
 * profile and the helper's audit counters, straight off
 * `reportedConfig.effective.obd`.
 *
 * Read-only by construction, like the SIM card: there is no desired value
 * for "is the ECU answering", so no ConfigStatusBadge. The one number an
 * operator must never miss is the forbidden-command count: a non-zero value
 * is a helper bug (it tried a command outside its allowlist or over budget),
 * never a bus fault, so it is highlighted the moment it is above zero.
 */

const TONE: Record<ObdStatusDisplay["tone"], { text?: string; icon: React.ReactNode }> = {
  ok: { icon: <CheckCircleIcon className="text-emerald-600 dark:text-emerald-400" /> },
  warn: { text: "text-amber-700 dark:text-amber-400", icon: <CircleDashedIcon /> },
  danger: { text: "text-destructive", icon: <AlertTriangleIcon /> },
  muted: { text: "text-muted-foreground", icon: <CircleHelpIcon /> },
}

export function ObdAdapterCard({
  device,
  onRefresh,
  refreshing = false,
}: {
  device: Device
  onRefresh?: () => void
  refreshing?: boolean
}) {
  const obd = reportedObd(device)
  const display = obdStatusDisplay(obd)
  const tone = TONE[display.tone]
  const profile = obdProfileSummary(obd?.profile ?? null)
  const audit = obd?.audit ?? null
  const forbidden = audit?.forbidden ?? 0

  return (
    <Card data-testid="obd-adapter-card">
      <CardHeader>
        <CardTitle>OBD adapter</CardTitle>
        <CardDescription>
          What the device reports about its adapter and the OBD-II bus. Read-only.
        </CardDescription>
        <CardAction className="flex items-center gap-1.5">
          {device.reportedAt !== null && (
            <span className="text-muted-foreground font-normal">
              Reported {formatTimestamp(device.reportedAt)}
            </span>
          )}
          {onRefresh !== undefined && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Re-read from the device now"
              aria-label="Refresh device state"
              disabled={refreshing || device.status !== "online"}
              onClick={onRefresh}
            >
              <RefreshCwIcon className={cn(refreshing && "animate-spin")} />
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid max-w-4xl grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 lg:grid-cols-2">
          <InfoRow
            label="Status"
            value={
              <span
                className={cn(
                  "flex items-center gap-1.5 font-medium",
                  tone.text,
                  "[&_svg]:size-3.5 [&_svg]:shrink-0"
                )}
              >
                {tone.icon}
                {display.label}
              </span>
            }
          />
          <InfoRow label="Link" value={obd === null ? "—" : OBD_LINK_LABELS[obd.link]} />
          <InfoRow label="Adapter in use" mono value={obd?.adapterMac ?? "—"} />
          {/* `env` means the bench seam (XORGATE_OBD_*) is overriding the
              namespace: the settings card is then not what the device runs. */}
          <InfoRow
            label="Settings source"
            value={
              obd?.source === null || obd === null
                ? "—"
                : obd.source === "env"
                  ? "Device environment (overrides settings)"
                  : "Settings"
            }
          />
          <InfoRow
            label="Bus profile"
            title={profile ?? undefined}
            value={profile ?? (obd === null ? "—" : "Nothing probed yet")}
          />
          <InfoRow label="Helper" value={obd?.helperVersion ?? "—"} />
        </dl>

        {audit !== null && (
          <dl className="grid max-w-4xl grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 lg:grid-cols-2">
            <InfoRow label="Requests" value={`${audit.requests} (${audit.ok} ok)`} />
            <InfoRow label="No data / timeouts" value={`${audit.noData} / ${audit.timeouts}`} />
            <InfoRow label="Reconnects" value={String(audit.reconnects)} />
            <InfoRow label="Distinct commands" value={String(audit.inventorySize)} />
            <InfoRow
              label="Forbidden attempts"
              value={
                <span
                  data-testid="obd-forbidden"
                  className={cn(
                    "flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:shrink-0",
                    forbidden > 0 && "font-medium text-destructive"
                  )}
                >
                  {forbidden > 0 && <AlertTriangleIcon />}
                  {forbidden}
                </span>
              }
            />
            <InfoRow
              label="Last stop"
              title={audit.lastStop?.reason ?? undefined}
              value={
                audit.lastStop === null
                  ? "—"
                  : `${audit.lastStop.reason ?? "stopped"}${
                      audit.lastStop.ts !== null
                        ? ` · ${formatTimestamp(new Date(audit.lastStop.ts).toISOString())}`
                        : ""
                    }`
              }
            />
          </dl>
        )}

        {forbidden > 0 && (
          <SettingsCallout
            icon={<AlertTriangleIcon />}
            className="border-destructive/40 text-destructive"
          >
            The OBD helper tried {forbidden} command{forbidden === 1 ? "" : "s"} outside its
            allowlist or budget. That is a software fault on the device, not the bus: the
            helper refused them, but report it.
          </SettingsCallout>
        )}
        {display.hint !== null && (
          <SettingsCallout
            icon={display.tone === "muted" ? undefined : tone.icon}
            className={cn(
              display.tone === "danger" && "border-destructive/40 text-destructive",
              display.tone === "warn" &&
                "border-amber-500/40 text-amber-700 dark:border-amber-400/40 dark:text-amber-400"
            )}
          >
            {display.hint}
          </SettingsCallout>
        )}
      </CardContent>
    </Card>
  )
}
