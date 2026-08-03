import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { RequirePermission } from "@/components/require-permission"
import {
  ArrowUpRightIcon,
  Building2Icon,
  CreditCardIcon,
  DownloadIcon,
  RadioIcon,
  RouterIcon,
  SparklesIcon,
  TriangleAlertIcon,
  VideoIcon,
  ZapIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DataTable, type DataTableColumn } from "@/components/data-table"
import { StickyHeader } from "@/components/sticky-header"
import type { UserTier } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import {
  compact,
  INVOICES,
  money,
  NEAR_LIMIT,
  notImplemented,
  PLANS,
  TIER_ORDER,
  USAGE,
  type Invoice,
  type Metric,
} from "./billing/-lib"
import {
  DetailRow,
  MetricCard,
  PlanCard,
} from "./billing/-components/plan-parts"

export const Route = createFileRoute("/billing")({
  beforeLoad: requireAuth,
  component: () => (
    <RequirePermission permission="billing:manage">
      <BillingPage />
    </RequirePermission>
  ),
})

function BillingPage() {
  const authUser = useAuthStore((s) => s.user)
  const [plansOpen, setPlansOpen] = useState(false)

  // Mock: the demo account is on Pro so the metering, payment method, and
  // invoice history all have something to show. Real value: authUser.tier.
  const currentTier: UserTier = "pro"
  const currentPlan = PLANS.find((p) => p.id === currentTier) ?? PLANS[0]!
  const nextPlan = PLANS.find(
    (p) => TIER_ORDER[p.id] === TIER_ORDER[currentTier] + 1
  )

  const metrics: Metric[] = [
    {
      key: "devices",
      label: "Connected devices",
      icon: RouterIcon,
      used: USAGE.devices,
      limit: currentPlan.limits.devices,
      unit: "devices",
    },
    {
      key: "streaming",
      label: "Data streamed",
      icon: RadioIcon,
      used: USAGE.streamingGb,
      limit: currentPlan.limits.streamingGb,
      unit: "GB",
    },
    {
      key: "runs",
      label: "Workflow runs",
      icon: ZapIcon,
      used: USAGE.workflowRuns,
      limit: currentPlan.limits.workflowRuns,
      unit: "runs",
    },
    {
      key: "storage",
      label: "Recording storage",
      icon: VideoIcon,
      used: USAGE.storageGb,
      limit: currentPlan.limits.storageGb,
      unit: "GB",
    },
  ]

  // Surface the most-consumed metric so the page can lead with a limit alert.
  const hottest = metrics
    .map((m) => ({ metric: m, pct: (m.used / m.limit) * 100 }))
    .sort((a, b) => b.pct - a.pct)[0]!
  const hotRemaining = Math.max(0, hottest.metric.limit - hottest.metric.used)
  const showAlert = hottest.pct >= NEAR_LIMIT && nextPlan

  const invoiceColumns: DataTableColumn<Invoice>[] = [
    {
      id: "invoice",
      header: "Invoice",
      cell: (inv) => (
        <div className="flex flex-col">
          <span className="font-medium">{inv.number}</span>
          <span className="text-[0.625rem] text-muted-foreground tabular-nums">
            {inv.date}
          </span>
        </div>
      ),
    },
    {
      id: "description",
      header: "Description",
      cellClassName: "text-muted-foreground",
      cell: (inv) => inv.description,
    },
    {
      id: "status",
      header: "Status",
      cell: (inv) => {
        const variant =
          inv.status === "failed"
            ? "destructive"
            : inv.status === "upcoming"
              ? "outline"
              : "secondary"
        const label =
          inv.status === "paid"
            ? "Paid"
            : inv.status === "upcoming"
              ? "Upcoming"
              : "Failed"
        return <Badge variant={variant}>{label}</Badge>
      },
    },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      cellClassName: "font-medium tabular-nums",
      cell: (inv) => money(inv.amount),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (inv) =>
        inv.status === "upcoming" ? null : (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label={`Download ${inv.number}`}
            onClick={notImplemented}
          >
            <DownloadIcon />
          </Button>
        ),
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <StickyHeader className="border-b border-border pb-4">
        <header className="flex flex-wrap items-start gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
            <p className="text-sm text-muted-foreground">
              Manage your plan, usage, and payment details.
            </p>
          </div>
          <Badge variant="outline" className="ml-auto capitalize">
            {currentPlan.name} plan
          </Badge>
        </header>
      </StickyHeader>

      <Tabs defaultValue="overview" className="gap-6">
        <div className="border-b border-border">
          <TabsList variant="line">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
          </TabsList>
        </div>

        {/* ---- Overview ---------------------------------------------------- */}
        <TabsContent value="overview" className="flex flex-col gap-6">
          {/* Limit alert — the most urgent thing, so it leads the page */}
          {showAlert ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
              <TriangleAlertIcon className="size-4 shrink-0 text-destructive" />
              <p className="text-xs">
                <span className="font-medium">
                  You're close to your{" "}
                  {hottest.metric.label.toLowerCase()} limit.
                </span>{" "}
                <span className="text-muted-foreground">
                  {compact(hotRemaining)} {hottest.metric.unit} left this
                  cycle — {Math.round(hottest.pct)}% used.
                </span>
              </p>
              <Button
                size="sm"
                className="ml-auto"
                onClick={() => setPlansOpen(true)}
              >
                Upgrade to {nextPlan!.name}
              </Button>
            </div>
          ) : null}

          {/* Current plan hero — anchored by typography, not a heavy fill */}
          <Card>
            <CardContent className="flex flex-col gap-6">
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {currentPlan.name}
                    </span>
                    <Badge variant="secondary">Current plan</Badge>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-4xl font-semibold tracking-tight tabular-nums">
                      {money(currentPlan.price, false)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      / month
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {currentPlan.tagline}
                  </p>
                </div>
                <div className="flex flex-col gap-1 rounded-lg bg-muted/50 px-4 py-3 sm:items-end">
                  <span className="text-[0.6875rem] tracking-wide text-muted-foreground uppercase">
                    Next payment
                  </span>
                  <span className="text-xl font-semibold tabular-nums">
                    {money(currentPlan.price)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Aug 1, 2026 · in 13 days
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {nextPlan ? (
                  <Button onClick={() => setPlansOpen(true)}>
                    <SparklesIcon />
                    Upgrade to {nextPlan.name}
                  </Button>
                ) : null}
                <Button variant="outline" onClick={() => setPlansOpen(true)}>
                  Compare plans
                </Button>
                <Button variant="ghost" onClick={notImplemented}>
                  <CreditCardIcon />
                  Manage payment
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Usage this cycle */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-sm font-medium">Usage this cycle</h2>
                <p className="text-xs text-muted-foreground">
                  Jul 1 – Jul 31, 2026 · resets in 13 days
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => (
                <MetricCard key={metric.key} metric={metric} />
              ))}
            </div>
          </section>

          {/* Payment method + billing details */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="border-b">
                <CardTitle>Payment method</CardTitle>
                <CardDescription>
                  Charged automatically each cycle.
                </CardDescription>
                <CardAction>
                  <Button size="sm" variant="outline" onClick={notImplemented}>
                    Update
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-md border border-border bg-muted/40">
                  <CreditCardIcon className="size-5" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    Visa ending in 4242
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Expires 08 / 2028
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b">
                <CardTitle>Billing details</CardTitle>
                <CardDescription>Where receipts are sent.</CardDescription>
                <CardAction>
                  <Button size="sm" variant="outline" onClick={notImplemented}>
                    Edit
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                <dl className="flex flex-col gap-3 text-xs">
                  <DetailRow
                    label="Billing email"
                    value={authUser?.email ?? "—"}
                  />
                  <DetailRow
                    label="Next payment"
                    value={`${money(currentPlan.price)} on Aug 1, 2026`}
                  />
                  <DetailRow label="Billing cycle" value="Monthly" />
                </dl>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---- Invoices ---------------------------------------------------- */}
        <TabsContent value="invoices">
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Invoices</CardTitle>
              <CardDescription>
                Download receipts for your records.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                card={false}
                columns={invoiceColumns}
                rows={INVOICES}
                getRowKey={(inv) => inv.number}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={plansOpen} onOpenChange={setPlansOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Choose a plan</DialogTitle>
            <DialogDescription>
              Every plan includes the full hardware-to-cloud stack. Upgrade as
              your fleet grows — changes are prorated to your cycle.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {PLANS.map((plan) => (
              <PlanCard key={plan.id} plan={plan} currentTier={currentTier} />
            ))}
          </div>

          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-md bg-muted">
                  <Building2Icon className="size-4.5" />
                </div>
                <div className="flex flex-col">
                  <p className="text-sm font-medium">Enterprise</p>
                  <p className="text-xs text-muted-foreground">
                    Custom hardware, unlimited fleet, dedicated support & SLAs.
                  </p>
                </div>
              </div>
              <Button variant="outline" onClick={notImplemented}>
                Contact sales
                <ArrowUpRightIcon />
              </Button>
            </CardContent>
          </Card>
        </DialogContent>
      </Dialog>
    </div>
  )
}
