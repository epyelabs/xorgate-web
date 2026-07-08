import { useCallback, useEffect, useMemo, useState } from "react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  ChevronDownIcon,
  FileDownIcon,
  FilterIcon,
  PlusIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DataTable,
  DataTableToolbar,
  StatusDot,
  type DataTableColumn,
} from "@/components/data-table"
import { listDevices, type Device, type DeviceStatus } from "@/lib/api"
import { listDevicesResponseSchema } from "@/lib/schemas"
import { formatRelative } from "@/lib/relative-time"
import { useAuthStore } from "@/store/auth"
import { useWorkspaceStore } from "@/store/workspace"
import { StickyHeader } from "@/components/sticky-header"
import { DevicesKpi, DevicesKpiSkeleton } from "./-components/devices-kpi"
import { ProvisionDeviceDialog } from "./-components/provision-device-dialog"

export const Route = createFileRoute("/devices/")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DevicesListPage,
})

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
})

function formatTimestamp(iso: string | null): string {
  if (!iso) return "Never"
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return dateTimeFormat.format(parsed)
}

function formatDate(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return dateFormat.format(parsed)
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

const STATUS_OPTIONS: readonly (DeviceStatus | "any")[] = [
  "any",
  "online",
  "offline",
  "provisioned",
  "decommissioned",
]

const DEVICE_STATUS_COLOR: Record<DeviceStatus, string> = {
  online: "bg-emerald-500",
  offline: "bg-amber-500",
  provisioned: "bg-sky-500",
  decommissioned: "bg-zinc-400",
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function exportCsv(rows: Device[]) {
  const header = [
    "serial",
    "name",
    "status",
    "firmware",
    "device_model_id",
    "last_seen_at",
    "created_at",
  ]
  const lines = [header.join(",")]
  for (const d of rows) {
    lines.push(
      [
        d.serial,
        d.name ?? "",
        d.status,
        d.firmwareVersion ?? "",
        d.deviceModelId,
        d.lastSeenAt ?? "",
        d.createdAt,
      ]
        .map((v) => csvEscape(String(v)))
        .join(",")
    )
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `devices-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

interface DevicesData {
  workspaceId: string | null
  devices: Device[]
}

function DevicesListPage() {
  const [data, setData] = useState<DevicesData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<DeviceStatus | "any">("any")
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [provisionOpen, setProvisionOpen] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const raw = await listDevices()
        const parsed = listDevicesResponseSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error("Unexpected /devices response shape")
        }
        if (cancelled) return
        setError(null)
        setData({
          workspaceId: currentWorkspaceId,
          devices: parsed.data.devices,
        })
        setSelected(new Set())
      } catch (err) {
        const message = (err as Error).message
        if (cancelled) return
        setError(message)
        setData({ workspaceId: currentWorkspaceId, devices: [] })
        toast.error(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [currentWorkspaceId, reloadNonce])

  const isLoading = !data || data.workspaceId !== currentWorkspaceId
  const devices = isLoading ? null : data.devices

  const filtered = useMemo(() => {
    if (!devices) return []
    const q = query.trim().toLowerCase()
    return devices.filter((d) => {
      if (statusFilter !== "any" && d.status !== statusFilter) return false
      if (!q) return true
      return (
        d.serial.toLowerCase().includes(q) ||
        (d.name ?? "").toLowerCase().includes(q)
      )
    })
  }, [devices, query, statusFilter])

  const clearFilters = () => {
    setQuery("")
    setStatusFilter("any")
  }
  const isFiltered = query.trim() !== "" || statusFilter !== "any"

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((d) => selected.has(d.id))
  const someFilteredSelected =
    filtered.some((d) => selected.has(d.id)) && !allFilteredSelected

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        for (const d of filtered) next.delete(d.id)
      } else {
        for (const d of filtered) next.add(d.id)
      }
      return next
    })
  }

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleProvision = () => setProvisionOpen(true)
  // Stable so it doesn't churn the dialog's polling effect. Re-fetches the
  // device list once a registration is claimed so the new device appears.
  const handleClaimed = useCallback(() => setReloadNonce((n) => n + 1), [])

  const columns: DataTableColumn<Device>[] = [
    {
      id: "device",
      header: "Device",
      cell: (device) => (
        <Link
          to="/devices/$id"
          params={{ id: device.id }}
          className="block leading-tight"
        >
          <span className="block text-sm font-medium text-foreground hover:underline">
            {device.name ?? device.serial}
          </span>
          {device.name ? (
            <span className="block text-xs text-muted-foreground">
              {device.serial}
            </span>
          ) : null}
        </Link>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (device) => (
        <StatusDot color={DEVICE_STATUS_COLOR[device.status]} label={device.status} />
      ),
    },
    {
      id: "firmware",
      header: "Firmware",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (device) => device.firmwareVersion ?? "—",
    },
    {
      id: "model",
      header: "Model",
      cellClassName: "text-muted-foreground",
      cell: (device) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default font-mono">
              {shortId(device.deviceModelId)}
            </span>
          </TooltipTrigger>
          <TooltipContent>{device.deviceModelId}</TooltipContent>
        </Tooltip>
      ),
    },
    {
      id: "lastSeen",
      header: "Last seen",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (device) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default">
              {formatRelative(device.lastSeenAt)}
            </span>
          </TooltipTrigger>
          <TooltipContent>{formatTimestamp(device.lastSeenAt)}</TooltipContent>
        </Tooltip>
      ),
    },
    {
      id: "created",
      header: "Created",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (device) => formatDate(device.createdAt),
    },
  ]

  const statusFilterMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <FilterIcon />
          status: {statusFilter}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {STATUS_OPTIONS.map((opt) => (
          <DropdownMenuItem key={opt} onSelect={() => setStatusFilter(opt)}>
            {opt}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <StickyHeader className="border-b border-border pb-4">
        <header className="flex flex-wrap items-start gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Devices</h1>
            <p className="text-sm text-muted-foreground">
              Physical units in the field. Status reflects the last heartbeat
              from the edge SDK.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="lg"
              onClick={() => exportCsv(filtered)}
              disabled={!devices || filtered.length === 0}
            >
              <FileDownIcon />
              Export CSV
            </Button>
            <Button variant="default" size="lg" onClick={handleProvision}>
              <PlusIcon />
              Register device
            </Button>
          </div>
        </header>
      </StickyHeader>

      {isLoading && !error ? (
        <DevicesKpiSkeleton />
      ) : devices ? (
        <DevicesKpi devices={devices} />
      ) : null}

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          getRowKey={(device) => device.id}
          loading={isLoading}
          skeletonRows={6}
          isFiltered={isFiltered}
          selection={{
            isSelected: (d) => selected.has(d.id),
            onToggle: (d) => toggleOne(d.id),
            allSelected: allFilteredSelected,
            someSelected: someFilteredSelected,
            onToggleAll: toggleAll,
            rowLabel: (d) => `Select ${d.serial}`,
          }}
          toolbar={
            <DataTableToolbar
              search={{
                value: query,
                onChange: setQuery,
                placeholder: "Filter by name or serial…",
              }}
              filters={statusFilterMenu}
              right={
                devices ? `Showing ${filtered.length} of ${devices.length}` : null
              }
            />
          }
          empty={
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">No devices yet</p>
                <p className="text-xs text-muted-foreground">
                  Provision your first device to start streaming.
                </p>
              </div>
              <Button variant="default" size="sm" onClick={handleProvision}>
                <PlusIcon />
                Register device
              </Button>
            </div>
          }
          filteredEmpty={
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                No devices match the current filters.
              </p>
              <Button variant="link" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          }
        />
      )}

      <ProvisionDeviceDialog
        open={provisionOpen}
        onOpenChange={setProvisionOpen}
        onClaimed={handleClaimed}
      />
    </div>
  )
}
