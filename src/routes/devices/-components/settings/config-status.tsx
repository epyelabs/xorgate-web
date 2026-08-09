import {
  AlertTriangleIcon,
  CheckIcon,
  CloudOffIcon,
  LoaderIcon,
  XCircleIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  CONFIG_STATE_LABELS,
  configStateExplanation,
  type NamespaceStatus,
} from "@/lib/device-config-status"
import { SettingsCallout } from "./callout"

/**
 * Desired-vs-reported affordances for a settings card (Phase 3).
 *
 * Two pieces, deliberately separate: a badge in the card header that is always
 * cheap to scan, and a callout in the card body that only appears when there is
 * something to say. A settings page that explains itself on every card explains
 * nothing, so `applied` and `unset` render no callout at all.
 */

const BADGE_VARIANTS: Record<
  NamespaceStatus["state"],
  { variant: "secondary" | "outline" | "destructive"; className?: string; icon: React.ReactNode }
> = {
  "no-report": { variant: "outline", icon: <CloudOffIcon /> },
  pending: { variant: "secondary", icon: <LoaderIcon className="animate-spin" /> },
  queued: { variant: "outline", icon: <CloudOffIcon /> },
  // Muted text, green tick: the badge stays quiet on a page where most cards
  // are settled, but the tick still reads as "good" at a glance.
  applied: {
    variant: "outline",
    className: "text-muted-foreground",
    icon: <CheckIcon className="text-emerald-600 dark:text-emerald-400" />,
  },
  adjusted: {
    variant: "outline",
    className:
      "border-amber-500/40 text-amber-700 dark:border-amber-400/40 dark:text-amber-400",
    icon: <AlertTriangleIcon />,
  },
  rejected: { variant: "destructive", icon: <XCircleIcon /> },
  unset: { variant: "outline", icon: null },
  // Amber, like `adjusted`: both are "the two sides disagree", which is a
  // warning to act on rather than a failure. Reserve destructive for a value
  // the device actually refused.
  diverged: {
    variant: "outline",
    className:
      "border-amber-500/40 text-amber-700 dark:border-amber-400/40 dark:text-amber-400",
    icon: <AlertTriangleIcon />,
  },
}

/** Disagreement, not failure — the amber treatment for the card callout. */
const AMBER_STATES = new Set<NamespaceStatus["state"]>(["adjusted", "diverged"])

/**
 * What the device says about this namespace, in a word. Rendered in the card
 * header (`CardAction`), so it sits on the title row rather than taking a row
 * of its own.
 */
export function ConfigStatusBadge({
  status,
  className,
}: {
  status: NamespaceStatus
  className?: string
}) {
  // "The cloud manages nothing here" is the default state of most devices and
  // is not news — a badge on every untouched card would be pure noise.
  if (status.state === "unset") return null
  const style = BADGE_VARIANTS[status.state]
  return (
    <Badge
      variant={style.variant}
      className={cn("gap-1 font-normal", style.className, className)}
    >
      {style.icon}
      {CONFIG_STATE_LABELS[status.state]}
    </Badge>
  )
}

/**
 * The sentence explaining a disagreement, an unreachable device, or an agent
 * that has never reported. Returns null when there is nothing worth saying.
 */
export function ConfigStatusCallout({
  status,
  className,
}: {
  status: NamespaceStatus
  className?: string
}) {
  const message = configStateExplanation(status)
  if (message === null) return null
  const tone =
    status.state === "rejected"
      ? "border-destructive/40 text-destructive"
      : AMBER_STATES.has(status.state)
        ? "border-amber-500/40 text-amber-700 dark:border-amber-400/40 dark:text-amber-400"
        : undefined
  return (
    <SettingsCallout
      icon={
        status.state === "rejected" ? (
          <XCircleIcon />
        ) : AMBER_STATES.has(status.state) ? (
          <AlertTriangleIcon />
        ) : undefined
      }
      className={cn(tone, className)}
    >
      {message}
    </SettingsCallout>
  )
}
