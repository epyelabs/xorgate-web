import { useState } from "react"
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
import type { Device } from "@/lib/api"
import {
  formatMsisdn,
  groupIccid,
  maskIccid,
  reportedSim,
  simCarrierLabel,
  simCheckedAgo,
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

/**
 * Tone follows `ConfigStatusBadge`'s restraint, which is the settings page's
 * established idiom: a healthy value gets **muted text and a coloured icon**,
 * never coloured text. Colour on the words is reserved for the states an
 * operator has to act on — which is what makes "No SIM detected" carry.
 */
const TONE: Record<SimDisplay["tone"], { text?: string; icon: React.ReactNode }> = {
  ok: { icon: <CheckCircleIcon className="text-emerald-600 dark:text-emerald-400" /> },
  warn: { text: "text-amber-700 dark:text-amber-400", icon: <CircleDashedIcon /> },
  danger: { text: "text-destructive", icon: <AlertTriangleIcon /> },
  muted: { text: "text-muted-foreground", icon: <CircleHelpIcon /> },
}

export function SimCard({
  device,
  onRefresh,
  refreshing = false,
}: {
  device: Device
  /** Phase 2 §4d: ask the device to re-probe + re-report now. */
  onRefresh?: () => void
  refreshing?: boolean
}) {
  const [revealed, setRevealed] = useState(false)
  const sim = reportedSim(device)
  const display = simDisplay(sim)
  const tone = TONE[display.tone]
  const carrier = simCarrierLabel(sim)
  const checked = simCheckedAgo(sim)

  return (
    <Card>
      <CardHeader>
        <CardTitle>SIM card</CardTitle>
        <CardDescription>
          The SIM currently in the device, as the modem reports it. Read-only.
        </CardDescription>
        {/* Freshness belongs on the title row, in the slot the sibling cards use
            for their status badge — this card has no badge, and "how old is
            this" is the analogous thing to know at a glance. The device reads
            the card on a slow cadence and reports on a slower one, so a reading
            can legitimately be tens of minutes old without anything being
            wrong; saying so is better than implying it is live. */}
        {(checked !== null || onRefresh !== undefined) && (
          <CardAction className="flex items-center gap-1.5">
            {checked !== null && (
              <span className="text-muted-foreground font-normal" title={checked.exact}>
                Read {checked.relative}
              </span>
            )}
            {/* §4d: the freshness stamp says whether a refresh is even needed;
                the button sits beside it because they answer the same question.
                One click covers the whole report (SIM, APN, uplink), and the
                device rate-limits itself, so hammering it is harmless. */}
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
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* No `text-*` here on purpose: Card sets the body scale to
            `text-xs/relaxed` and every FieldLabel/FieldDescription on this tab
            inherits it. Setting a size would put this card a full step off the
            rest of the page — it did, and it is what made it look foreign.
            Width is capped so four short values cluster instead of stretching
            across a wide monitor as four islands. Back to two columns at `lg`,
            where the connectivity tab pairs this card with the APN and the card
            itself is only half the page — four columns there squeeze the ICCID
            and its Reveal button onto separate lines. */}
        <dl className="grid max-w-4xl grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 lg:grid-cols-2">
          <InfoRow
            label="Status"
            value={
              <span
                className={cn(
                  "flex items-center gap-1.5 font-medium",
                  tone.text,
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
              masking. Not mono: it is a number to read, not a serial to scan
              character by character, and mono's wide digits made "+1 437…"
              straggle next to its neighbours. */}
          {sim?.msisdn !== undefined && (
            <InfoRow label="Phone number" value={formatMsisdn(sim.msisdn)} />
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
                <span className="flex items-baseline gap-2">
                  <span className="truncate">
                    {revealed ? groupIccid(sim.iccid) : maskIccid(sim.iccid)}
                  </span>
                  <Button
                    variant="link"
                    size="xs"
                    className="h-auto shrink-0 px-0 font-sans"
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
