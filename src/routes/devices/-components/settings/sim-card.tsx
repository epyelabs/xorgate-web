import { useState } from "react"
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  CircleHelpIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { Device } from "@/lib/api"
import {
  formatMsisdn,
  groupIccid,
  maskIccid,
  reportedSim,
  simCarrierLabel,
  simDisplay,
  type SimDisplay,
} from "@/lib/device-sim"
import { cn } from "@/lib/utils"
import { InfoRow } from "../info-row"
import { SettingsCallout } from "./callout"

/**
 * The SIM currently in the device (manage_sim_card_info_in_settings, Phase 1).
 *
 * Read-only by construction: there is no save, no patch and deliberately no
 * `ConfigStatusBadge` — that badge answers "is the desired value in force", and
 * there is no desired value for a card serial. Every decision this renders is
 * made by `lib/device-sim.ts`, which is where the tests live (the frontend
 * vitest runs without a DOM).
 *
 * The state that justifies the whole card is "No SIM detected". It has to be
 * impossible to read as "no signal" — that confusion cost a day on 2026-08-08 —
 * and equally impossible to reach from a device that has simply never reported.
 */

const TONE: Record<SimDisplay["tone"], { className: string; icon: React.ReactNode }> = {
  ok: {
    className: "text-emerald-700 dark:text-emerald-400",
    icon: <CheckCircleIcon />,
  },
  warn: {
    className: "text-amber-700 dark:text-amber-400",
    icon: <CircleDashedIcon />,
  },
  danger: { className: "text-destructive", icon: <AlertTriangleIcon /> },
  muted: { className: "text-muted-foreground", icon: <CircleHelpIcon /> },
}

export function SimCard({ device }: { device: Device }) {
  const [revealed, setRevealed] = useState(false)
  const sim = reportedSim(device)
  const display = simDisplay(sim)
  const tone = TONE[display.tone]
  const carrier = simCarrierLabel(sim)

  return (
    <Card>
      <CardHeader>
        <CardTitle>SIM card</CardTitle>
        <CardDescription>
          The SIM currently in the device, as the modem reports it. Read-only.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm lg:grid-cols-4">
          <InfoRow
            label="Status"
            value={
              <span
                className={cn(
                  "flex items-center gap-1.5 font-medium",
                  tone.className,
                  "[&_svg]:size-3.5 [&_svg]:shrink-0",
                )}
              >
                {tone.icon}
                {display.label}
              </span>
            }
          />
          <InfoRow label="Carrier" value={carrier ?? "—"} />
          {/* Conditional on purpose: AT+CNUM reads EF_MSISDN, which many
              carriers never write. A permanent blank "Phone number —" reads as
              a fault when it is just a carrier that does not publish it.
              Shown in full — it is the value an operator copies to text the
              device's SIM or match a carrier invoice; the ICCID carries the
              masking. */}
          {sim?.msisdn !== undefined && (
            <InfoRow label="Phone number" value={formatMsisdn(sim.msisdn)} mono />
          )}
          {/* Masked by default: an ICCID identifies a subscriber, not just a
              piece of hardware, and it now lives in the DB, the API and this
              browser. The last four are what matches the number printed on the
              card, so they stay visible either way. */}
          <InfoRow
            label="ICCID"
            mono
            value={
              sim?.iccid === undefined ? (
                "—"
              ) : (
                <span className="flex items-center gap-1.5">
                  <span className="truncate">
                    {revealed ? groupIccid(sim.iccid) : maskIccid(sim.iccid)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto px-1 py-0 font-sans text-xs"
                    onClick={() => setRevealed((v) => !v)}
                  >
                    {revealed ? "Hide" : "Reveal"}
                  </Button>
                </span>
              )
            }
          />
        </dl>
        {display.hint !== null && (
          <SettingsCallout
            icon={display.tone === "muted" ? undefined : tone.icon}
            className={cn(
              display.tone === "danger" && "border-destructive/40 text-destructive",
              display.tone === "warn" &&
                "border-amber-500/40 text-amber-700 dark:border-amber-400/40 dark:text-amber-400",
            )}
          >
            {display.hint}
          </SettingsCallout>
        )}
      </CardContent>
    </Card>
  )
}
