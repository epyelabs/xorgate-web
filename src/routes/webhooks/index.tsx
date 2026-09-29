import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { toast } from "sonner"
import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { DataTable, type DataTableColumn } from "@/components/data-table"
import { StickyHeader } from "@/components/sticky-header"
import { CreateWebhookDialog } from "@/components/webhooks/create-webhook-dialog"
import { EndpointStateBadge } from "@/components/webhooks/webhook-status"
import { xgMessage } from "@/lib/xorgate"
import { useHasPermission } from "@/lib/permissions"
import { formatRelative } from "@/lib/relative-time"
import { urlHost, type WebhookEndpoint } from "@/lib/webhooks-api"
import { useWebhookEndpoints } from "@/queries/webhooks"
import { useWorkspaceStore } from "@/store/workspace"

// The org's endpoint registry (plans/xorgate-webhooks D1): URL + signing
// secret, no routing of its own. Every role may read it; registering,
// rotating, testing and redelivering are owner/admin (`webhooks:manage`).
export const Route = createFileRoute("/webhooks/")({
  beforeLoad: requireAuth,
  component: WebhooksPage,
})

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

function When({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-muted-foreground">Never</span>
  const parsed = new Date(iso)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default">{formatRelative(iso)}</span>
      </TooltipTrigger>
      <TooltipContent>
        {Number.isNaN(parsed.getTime()) ? iso : dateTimeFormat.format(parsed)}
      </TooltipContent>
    </Tooltip>
  )
}

function WebhooksPage() {
  const [createOpen, setCreateOpen] = useState(false)
  const navigate = useNavigate()
  const canManage = useHasPermission("webhooks:manage")
  const currentOrganizationId = useWorkspaceStore(
    (s) => s.currentOrganizationId
  )
  const endpointsQuery = useWebhookEndpoints()
  const endpoints = endpointsQuery.data?.items ?? []
  const error =
    endpointsQuery.data || !endpointsQuery.error
      ? null
      : xgMessage(endpointsQuery.error)

  useEffect(() => {
    if (endpointsQuery.error && !endpointsQuery.data) {
      toast.error(xgMessage(endpointsQuery.error))
    }
  }, [endpointsQuery.error, endpointsQuery.data])

  const columns: DataTableColumn<WebhookEndpoint>[] = [
    {
      id: "name",
      header: "Name",
      cellClassName: "font-mono text-xs font-medium",
      cell: (ep) => ep.name,
    },
    {
      id: "url",
      header: "URL",
      cellClassName: "max-w-64 truncate text-muted-foreground",
      cell: (ep) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default">{urlHost(ep.url)}</span>
          </TooltipTrigger>
          <TooltipContent>{ep.url}</TooltipContent>
        </Tooltip>
      ),
    },
    {
      id: "state",
      header: "Status",
      cell: (ep) => <EndpointStateBadge endpoint={ep} />,
    },
    {
      id: "lastSuccessAt",
      header: "Last success",
      cellClassName: "tabular-nums",
      cell: (ep) => <When iso={ep.lastSuccessAt} />,
    },
    {
      id: "consecutiveFailures",
      header: "Failures in a row",
      numeric: true,
      cell: (ep) => (
        <span
          className={
            ep.consecutiveFailures > 0 ? "text-destructive" : "text-muted-foreground"
          }
        >
          {ep.consecutiveFailures}
        </span>
      ),
    },
    {
      id: "createdAt",
      header: "Created",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (ep) => <When iso={ep.createdAt} />,
    },
  ]

  const createButton = (size: "lg" | "sm") => (
    <Button
      size={size}
      onClick={() => setCreateOpen(true)}
      disabled={!currentOrganizationId || !canManage}
      title={canManage ? undefined : "Owners and admins register endpoints"}
    >
      <PlusIcon />
      New endpoint
    </Button>
  )

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-0 min-w-0 flex-col gap-6 p-4 pt-0 group-has-data-[collapsible=icon]/sidebar-wrapper:h-[calc(100svh-3rem)]">
      <StickyHeader className="border-b border-border pb-4">
        <header className="flex flex-wrap items-start gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Webhook endpoints
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              HTTPS receivers for signed event deliveries. Route to them from a
              workflow's <span className="font-medium">Event</span> node
              (workflow events) or from a device's Settings, Webhooks tab
              (presence and session events).
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {createButton("lg")}
          </div>
        </header>
      </StickyHeader>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <DataTable
          fillHeight
          className="min-h-0 flex-1"
          columns={columns}
          rows={endpoints}
          getRowKey={(ep) => ep.id}
          loading={endpointsQuery.isPending}
          skeletonRows={3}
          onRowClick={(ep) =>
            void navigate({ to: "/webhooks/$id", params: { id: ep.id } })
          }
          empty={
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">No webhook endpoints yet</p>
                <p className="text-xs text-muted-foreground">
                  Register one to receive workflow, presence and session events.
                </p>
              </div>
              {createButton("sm")}
            </div>
          }
        />
      )}

      {/* Stays on the list while the secret shows; the dialog refreshes the
          list behind it, so the new row is one click away. */}
      <CreateWebhookDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
