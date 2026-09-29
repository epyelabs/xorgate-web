import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  BanIcon,
  KeyRoundIcon,
  PowerIcon,
  RotateCcwIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react"
import { isXorgateError } from "@xorgate/sdk"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DataTable, type DataTableColumn } from "@/components/data-table"
import { StickyHeader } from "@/components/sticky-header"
import { NotFoundScreen } from "@/components/error-screens"
import { CopyButton } from "@/components/models/copy-button"
import { Fact, FactGrid } from "@/components/models/facts"
import { SectionCard } from "@/components/models/section-card"
import {
  DeliveryStatusBadge,
  EndpointStateBadge,
} from "@/components/webhooks/webhook-status"
import { requireAuth } from "@/lib/auth-guard"
import { useHasPermission } from "@/lib/permissions"
import { formatRelative } from "@/lib/relative-time"
import { xg, xgMessage } from "@/lib/xorgate"
import {
  disabledLabel,
  type WebhookDelivery,
  type WebhookDeliveryStatus,
} from "@/lib/webhooks-api"
import {
  useInvalidateWebhooks,
  useWebhookDeliveries,
  useWebhookEndpoint,
} from "@/queries/webhooks"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import { DeleteWebhookDialog } from "./-components/delete-webhook-dialog"
import { DeliveryDrawer } from "./-components/delivery-drawer"
import { RotateSecretDialog } from "./-components/rotate-secret-dialog"

export const Route = createFileRoute("/webhooks/$id")({
  beforeLoad: requireAuth,
  component: WebhookDetailPage,
})

const PAGE_SIZES = [10, 25, 50]
// A ping lands in about a second; a first real attempt within seconds.
const WATCH_MS = 20_000
const STATUS_FILTERS: (WebhookDeliveryStatus | "any")[] = [
  "any",
  "pending",
  "delivered",
  "failed",
  "exhausted",
]

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
})

function formatAt(iso: string | null): string {
  if (!iso) return "Never"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : dateTimeFormat.format(d)
}

function WebhookDetailPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const canManage = useHasPermission("webhooks:manage")
  const invalidate = useInvalidateWebhooks()

  // Set by "Send test" / "Redeliver": poll the log and the stats for a short
  // window so the new delivery row shows up without a manual refresh.
  const [pollUntil, setPollUntil] = useState<number | undefined>(undefined)
  const watch = () => setPollUntil(Date.now() + WATCH_MS)
  const endpointQuery = useWebhookEndpoint(id, pollUntil)
  const endpoint = endpointQuery.data ?? null

  const [page, setPage] = useState(1)
  const [size, setSize] = useState(PAGE_SIZES[1])
  const [statusFilter, setStatusFilter] = useState<WebhookDeliveryStatus | "any">("any")
  const deliveriesQuery = useWebhookDeliveries(id, {
    limit: size,
    offset: (page - 1) * size,
    order: "desc",
    status: statusFilter === "any" ? undefined : statusFilter,
  }, pollUntil)
  const deliveries = deliveriesQuery.data?.items ?? []

  const [openDelivery, setOpenDelivery] = useState<string | null>(null)
  const [rotateOpen, setRotateOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [busy, setBusy] = useState<"test" | "toggle" | string | null>(null)

  useEffect(() => {
    if (endpoint) useBreadcrumbStore.getState().setWebhookName(endpoint.name)
  }, [endpoint])
  useEffect(() => {
    return () => useBreadcrumbStore.getState().setWebhookName(null)
  }, [id])

  if (endpointQuery.error && isXorgateError(endpointQuery.error) && endpointQuery.error.status === 404) {
    return <NotFoundScreen />
  }
  if (endpointQuery.error && !endpoint) {
    return (
      <div className="p-4 pt-0">
        <p className="text-sm text-destructive">{xgMessage(endpointQuery.error)}</p>
      </div>
    )
  }
  if (!endpoint) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4 pt-0">
        <Skeleton className="h-12 w-full max-w-2xl" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  async function sendTest() {
    setBusy("test")
    try {
      const res = await xg().webhooks.test(id)
      toast.success(
        res.dispatched
          ? "Ping queued; it appears below within seconds."
          : "Ping recorded, but delivery is switched off on this deployment."
      )
      setStatusFilter("any")
      setPage(1)
      watch()
      invalidate()
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function setEnabled(enabled: boolean) {
    setBusy("toggle")
    try {
      await xg().webhooks.update(id, { enabled })
      toast.success(enabled ? "Endpoint enabled" : "Endpoint disabled")
      invalidate()
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function redeliver(delivery: WebhookDelivery) {
    setBusy(delivery.id)
    try {
      await xg().webhooks.deliveries.redeliver(id, delivery.id)
      toast.success("Redelivery queued (same webhook-id, fresh retry schedule)")
      setPage(1)
      watch()
      invalidate()
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const columns: DataTableColumn<WebhookDelivery>[] = [
    {
      id: "status",
      header: "Status",
      cell: (d) => <DeliveryStatusBadge status={d.status} />,
    },
    {
      id: "eventType",
      header: "Event",
      cellClassName: "font-mono text-xs",
      cell: (d) => (
        <span>
          {d.eventType ?? "event"}
          {d.redeliveryOf ? (
            <span className="ml-1.5 font-sans text-[11px] text-muted-foreground">
              (redelivery)
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "attempt",
      header: "Attempt",
      numeric: true,
      cell: (d) => `${d.attempt}/8`,
    },
    {
      id: "responseStatus",
      header: "Response",
      numeric: true,
      cell: (d) =>
        d.responseStatus ?? (
          <span className="text-muted-foreground" title={d.error ?? undefined}>
            {d.error ? "error" : "—"}
          </span>
        ),
    },
    {
      id: "responseMs",
      header: "ms",
      numeric: true,
      cellClassName: "text-muted-foreground",
      cell: (d) => d.responseMs ?? "—",
    },
    {
      id: "createdAt",
      header: "Time",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (d) => <span title={formatAt(d.createdAt)}>{formatRelative(d.createdAt)}</span>,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (d) =>
        canManage ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={!endpoint.enabled || busy === d.id}
            title={endpoint.enabled ? "Send this event again" : "Enable the endpoint first"}
            onClick={(e) => {
              e.stopPropagation()
              void redeliver(d)
            }}
          >
            <RotateCcwIcon />
            Redeliver
          </Button>
        ) : null,
    },
  ]

  const stats = endpoint.deliveryStats

  return (
    <div className="flex flex-1 flex-col gap-5 p-4 pt-0" data-testid="webhook-detail">
      <StickyHeader className="border-b border-border pb-4">
        <header className="flex flex-wrap items-start gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-2xl font-semibold tracking-tight">{endpoint.name}</h1>
              <EndpointStateBadge endpoint={endpoint} />
            </div>
            <p className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
              <span className="truncate font-mono text-xs">{endpoint.url}</span>
              <CopyButton value={endpoint.url} label="Copy URL" />
            </p>
            {endpoint.description ? (
              <p className="text-sm text-muted-foreground">{endpoint.description}</p>
            ) : null}
          </div>
          {canManage ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => void sendTest()}
                disabled={!endpoint.enabled || busy === "test"}
                title={endpoint.enabled ? "POST a ping event to this endpoint" : "Enable the endpoint first"}
              >
                <SendIcon />
                Send test
              </Button>
              <Button variant="outline" onClick={() => setRotateOpen(true)}>
                <KeyRoundIcon />
                Rotate secret
              </Button>
              {endpoint.enabled ? (
                <Button
                  variant="outline"
                  onClick={() => void setEnabled(false)}
                  disabled={busy === "toggle"}
                >
                  <BanIcon />
                  Disable
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                aria-label="Delete endpoint"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2Icon />
              </Button>
            </div>
          ) : null}
        </header>
      </StickyHeader>

      {!endpoint.enabled ? (
        <Alert variant="destructive" data-testid="webhook-disabled-banner">
          <BanIcon />
          <AlertTitle>{disabledLabel(endpoint)}</AlertTitle>
          <AlertDescription>
            {endpoint.disabledReason === "gone"
              ? "The receiver answered 410 Gone, which means “stop sending”. "
              : endpoint.disabledReason === "failing"
                ? "Five deliveries in a row used up every retry, over more than a day, so xorgate stopped sending and emailed the organization’s owners. "
                : "Disabled by an owner or admin. "}
            Nothing is delivered while it is disabled; events routed to it still
            appear in this log and can be redelivered once it is enabled.
            {endpoint.disabledAt ? ` Since ${formatAt(endpoint.disabledAt)}.` : null}
          </AlertDescription>
          {canManage ? (
            <AlertAction>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void setEnabled(true)}
                disabled={busy === "toggle"}
              >
                <PowerIcon />
                Enable
              </Button>
            </AlertAction>
          ) : null}
        </Alert>
      ) : null}

      <SectionCard>
        <FactGrid columns={4}>
          <Fact label="Last success" value={formatAt(endpoint.lastSuccessAt)} />
          <Fact label="Last delivery" value={formatAt(endpoint.lastDeliveryAt)} />
          <Fact
            label="Exhausted in a row"
            value={String(endpoint.consecutiveFailures)}
            hint="Deliveries that used all 8 attempts"
          />
          <Fact label="Secret version" value={String(endpoint.secretVersion)} />
          {stats ? (
            <Fact
              label={`Last ${stats.windowHours} h`}
              span
              value={
                <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>{stats.delivered} delivered</span>
                  <span>{stats.pending} pending</span>
                  <span className={stats.failed ? "text-destructive" : undefined}>
                    {stats.failed} failed
                  </span>
                  <span className={stats.exhausted ? "text-destructive" : undefined}>
                    {stats.exhausted} exhausted
                  </span>
                </span>
              }
            />
          ) : null}
        </FactGrid>
      </SectionCard>

      <DataTable
        title="Deliveries"
        action={
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v as WebhookDeliveryStatus | "any")
              setPage(1)
            }}
          >
            <SelectTrigger className="h-8 w-36" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "any" ? "All statuses" : s[0].toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        columns={columns}
        rows={deliveries}
        getRowKey={(d) => d.id}
        loading={deliveriesQuery.isPending}
        skeletonRows={4}
        onRowClick={(d) => setOpenDelivery(d.id)}
        isFiltered={statusFilter !== "any"}
        filteredEmpty={
          <p className="py-10 text-center text-sm text-muted-foreground">
            No {statusFilter} deliveries.
          </p>
        }
        empty={
          <p className="py-10 text-center text-sm text-muted-foreground">
            No deliveries yet. Send a test, or route a device or a workflow
            node to <span className="font-mono">{endpoint.name}</span>. Kept for
            30 days.
          </p>
        }
        pagination={{
          page,
          pageSize: size,
          total: deliveriesQuery.data?.page.total ?? 0,
          rowsOnPage: deliveries.length,
          pageSizes: PAGE_SIZES,
          onPageChange: setPage,
          onPageSizeChange: (s) => {
            setSize(s)
            setPage(1)
          },
        }}
      />

      <DeliveryDrawer
        endpointId={id}
        deliveryId={openDelivery}
        onOpenChange={(open) => {
          if (!open) setOpenDelivery(null)
        }}
        canRedeliver={canManage && endpoint.enabled}
        onRedeliver={(d) => void redeliver(d)}
      />
      <RotateSecretDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        endpoint={endpoint}
        onRotated={invalidate}
      />
      <DeleteWebhookDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        endpoint={endpoint}
        onDeleted={() => {
          invalidate()
          void navigate({ to: "/webhooks" })
        }}
      />
    </div>
  )
}
