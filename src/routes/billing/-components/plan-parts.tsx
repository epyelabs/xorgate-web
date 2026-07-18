import { CircleCheckIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { UserTier } from "@/lib/api"
import {
  compact,
  money,
  NEAR_LIMIT,
  notImplemented,
  TIER_ORDER,
  type Metric,
  type Plan,
} from "../-lib"

export function UsageBar({ pct }: { pct: number }) {
  const near = pct >= NEAR_LIMIT
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          near ? "bg-destructive" : "bg-foreground"
        )}
        style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
      />
    </div>
  )
}

export function MetricCard({ metric }: { metric: Metric }) {
  const { icon: Icon, label, used, limit, unit } = metric
  const pct = (used / limit) * 100
  const near = pct >= NEAR_LIMIT
  const remaining = Math.max(0, limit - used)
  return (
    <Card size="sm" className={cn(near && "ring-destructive/50")}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon className="size-4" />
            <span className="text-xs font-medium">{label}</span>
          </div>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[0.625rem] font-medium tabular-nums",
              near
                ? "bg-destructive/10 text-destructive"
                : "text-muted-foreground"
            )}
          >
            {Math.round(pct)}%
          </span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl leading-none font-semibold tabular-nums">
            {compact(used)}
          </span>
          <span className="text-xs text-muted-foreground">
            / {compact(limit)} {unit}
          </span>
        </div>
        <UsageBar pct={pct} />
        <p
          className={cn(
            "text-[0.6875rem]",
            near ? "font-medium text-destructive" : "text-muted-foreground"
          )}
        >
          {near ? "Only " : ""}
          {compact(remaining)} {unit} left
        </p>
      </CardContent>
    </Card>
  )
}

export function PlanCard({
  plan,
  currentTier,
}: {
  plan: Plan
  currentTier: UserTier
}) {
  const isCurrent = plan.id === currentTier
  const isUpgrade = TIER_ORDER[plan.id] > TIER_ORDER[currentTier]

  return (
    <Card
      className={cn(
        "relative flex flex-col",
        isCurrent && "ring-2 ring-foreground"
      )}
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{plan.name}</CardTitle>
          {isCurrent ? (
            <Badge variant="secondary">Current</Badge>
          ) : plan.popular ? (
            <Badge>Popular</Badge>
          ) : null}
        </div>
        <CardDescription>{plan.tagline}</CardDescription>
        <div className="flex items-baseline gap-1 pt-2">
          <span className="text-3xl font-semibold tracking-tight tabular-nums">
            {money(plan.price, false)}
          </span>
          <span className="text-xs text-muted-foreground">/ month</span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <ul className="flex flex-col gap-2">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-xs">
              <CircleCheckIcon className="mt-px size-3.5 shrink-0 text-muted-foreground" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          variant={isCurrent ? "outline" : isUpgrade ? "default" : "ghost"}
          disabled={isCurrent}
          onClick={notImplemented}
        >
          {isCurrent
            ? "Current plan"
            : isUpgrade
              ? `Upgrade to ${plan.name}`
              : `Switch to ${plan.name}`}
        </Button>
      </CardFooter>
    </Card>
  )
}

export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
