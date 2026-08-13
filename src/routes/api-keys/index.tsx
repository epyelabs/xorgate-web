import { useCallback, useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { RequirePermission } from "@/components/require-permission"
import { toast } from "sonner"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { DataTable, type DataTableColumn } from "@/components/data-table"
import { StickyHeader } from "@/components/sticky-header"
import { listApiKeys, type ApiKey } from "@/lib/api"
import { formatRelative } from "@/lib/relative-time"
import { useWorkspaceStore } from "@/store/workspace"
import { CreateApiKeyDialog } from "./-components/create-api-key-dialog"
import { DeleteApiKeyDialog } from "./-components/delete-api-key-dialog"

export const Route = createFileRoute("/api-keys/")({
  beforeLoad: requireAuth,
  component: () => (
    <RequirePermission permission="api-keys:manage">
      <ApiKeysPage />
    </RequirePermission>
  ),
})

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })

function formatDate(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return dateFormat.format(parsed)
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "Never"
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return dateTimeFormat.format(parsed)
}

const SCOPE_LABEL: Record<ApiKey["scope"], string> = {
  edge: "Edge",
  cloud: "Cloud",
  client: "Client",
}

const ROLE_LABEL: Record<ApiKey["role"], string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
}

// A key is dead in two different ways, and the table says which.
function keyState(key: ApiKey): "revoked" | "expired" | "active" {
  if (key.revokedAt) return "revoked"
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now())
    return "expired"
  return "active"
}

interface ApiKeysData {
  organizationId: string | null
  keys: ApiKey[]
}

function ApiKeysPage() {
  const [data, setData] = useState<ApiKeysData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleting, setDeleting] = useState<ApiKey | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const currentOrganizationId = useWorkspaceStore(
    (s) => s.currentOrganizationId
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { api_keys } = await listApiKeys()
        if (cancelled) return
        setError(null)
        setData({ organizationId: currentOrganizationId, keys: api_keys })
      } catch (err) {
        const message = (err as Error).message
        if (cancelled) return
        setError(message)
        setData({ organizationId: currentOrganizationId, keys: [] })
        toast.error(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [currentOrganizationId, reloadNonce])

  const isLoading = !data || data.organizationId !== currentOrganizationId
  const keys = isLoading ? [] : data.keys

  const reload = useCallback(() => setReloadNonce((n) => n + 1), [])

  const columns: DataTableColumn<ApiKey>[] = [
    {
      id: "name",
      header: "Name",
      cellClassName: "font-medium",
      cell: (key) => key.name,
    },
    {
      id: "keyPrefix",
      header: "Key",
      cellClassName: "font-mono text-xs text-muted-foreground",
      // Only the hash was ever stored, so keys minted before this column
      // existed genuinely cannot show one. Say unknown rather than pretend.
      cell: (key) =>
        key.keyPrefix ? (
          `${key.keyPrefix}\u2026`
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default italic">Unknown</span>
            </TooltipTrigger>
            <TooltipContent>
              Minted before key prefixes were recorded. Only the hash was
              stored, so this cannot be recovered.
            </TooltipContent>
          </Tooltip>
        ),
    },
    {
      id: "role",
      header: "Role",
      cell: (key) => <Badge variant="outline">{ROLE_LABEL[key.role]}</Badge>,
    },
    {
      id: "scope",
      header: "Scope",
      cell: (key) => <Badge variant="secondary">{SCOPE_LABEL[key.scope]}</Badge>,
    },
    {
      id: "expiresAt",
      header: "Status",
      cell: (key) => {
        const state = keyState(key)
        if (state === "revoked")
          return <Badge variant="destructive">Revoked</Badge>
        if (state === "expired")
          return <Badge variant="destructive">Expired</Badge>
        if (!key.expiresAt) return <Badge variant="secondary">Active</Badge>
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="cursor-default">
                Expires {formatDate(key.expiresAt)}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>{formatTimestamp(key.expiresAt)}</TooltipContent>
          </Tooltip>
        )
      },
    },
    {
      id: "lastUsedAt",
      header: "Last used",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (key) =>
        key.lastUsedAt ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default">
                {formatRelative(key.lastUsedAt)}
              </span>
            </TooltipTrigger>
            <TooltipContent>{formatTimestamp(key.lastUsedAt)}</TooltipContent>
          </Tooltip>
        ) : (
          "Never"
        ),
    },
    {
      id: "createdAt",
      header: "Created",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (key) => formatDate(key.createdAt),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (key) => (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          aria-label={`Revoke ${key.name}`}
          onClick={() => setDeleting(key)}
        >
          <Trash2Icon />
        </Button>
      ),
    },
  ]

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-0 min-w-0 flex-col gap-6 p-4 pt-0 group-has-data-[collapsible=icon]/sidebar-wrapper:h-[calc(100svh-3rem)]">
      <StickyHeader className="border-b border-border pb-4">
        <header className="flex flex-wrap items-start gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">API Keys</h1>
            <p className="text-sm text-muted-foreground">
              Keys that authenticate programmatic access to this organization.
              Send one as an <code>Authorization: Bearer</code> credential; it
              acts inside this organization at the role shown.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="lg"
              onClick={() => setCreateOpen(true)}
              disabled={!currentOrganizationId}
            >
              <PlusIcon />
              Create API key
            </Button>
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
          rows={keys}
          getRowKey={(key) => key.id}
          loading={isLoading}
          skeletonRows={4}
          empty={
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">No API keys yet</p>
                <p className="text-xs text-muted-foreground">
                  Create a key to authenticate programmatic access.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => setCreateOpen(true)}
                disabled={!currentOrganizationId}
              >
                <PlusIcon />
                Create API key
              </Button>
            </div>
          }
        />
      )}

      <CreateApiKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={reload}
      />
      <DeleteApiKeyDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        apiKey={deleting}
        onDeleted={reload}
      />
    </div>
  )
}
