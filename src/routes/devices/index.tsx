import { useCallback, useEffect, useMemo, useState } from "react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { toast } from "sonner"
import { ChevronDownIcon, FilterIcon, PlusIcon } from "lucide-react"
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

type SortKey = "lastSeenAt" | "createdAt"
const PAGE_SIZES = [25, 50, 100]
const DEFAULT_SIZE = 25
// The KPI tiles aggregate the whole fleet, so the page loads every device (in
// pages of FLEET_PAGE) and slices/filters/sorts client-side. FLEET_CAP guards
// against an unbounded load on a very large fleet.
const FLEET_PAGE = 500
const FLEET_CAP = 5000

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
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [order, setOrder] = useState<"asc" | "desc">("desc")
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Load the whole fleet (paged) so the KPI counts are accurate; the
        // table paginates/filters/sorts this client-side. Default server order
        // (updatedAt desc) is the table's baseline order.
        const all: Device[] = []
        let offset = 0
        let total = Infinity
        while (offset < total && all.length < FLEET_CAP) {
          const raw = await listDevices({ limit: FLEET_PAGE, offset })
          const parsed = listDevicesResponseSchema.safeParse(raw)
          if (!parsed.success) {
            throw new Error("Unexpected /devices response shape")
          }
          all.push(...parsed.data.devices)
          total = parsed.data.page?.total ?? parsed.data.devices.length
          if (parsed.data.devices.length === 0) break
          offset += FLEET_PAGE
        }
        if (cancelled) return
        setError(null)
        setData({ workspaceId: currentWorkspaceId, devices: all })
        setSelected(new Set())
        setPage(1)
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
  const fleet = isLoading ? null : data.devices

  // Status filter + name/serial search (client-side over the whole fleet).
  const filtered = useMemo(() => {
    if (!fleet) return []
    const q = query.trim().toLowerCase()
    return fleet.filter((d) => {
      if (statusFilter !== "any" && d.status !== statusFilter) return false
      if (!q) return true
      return (
        d.serial.toLowerCase().includes(q) ||
        (d.name ?? "").toLowerCase().includes(q)
      )
    })
  }, [fleet, query, statusFilter])

  // Optional client sort (Last seen / Created). Without an active sort the fleet
  // keeps the server's updatedAt-desc order.
  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const dir = order === "asc" ? 1 : -1
    const value = (d: Device) =>
      sortKey === "createdAt"
        ? Date.parse(d.createdAt)
        : d.lastSeenAt
          ? Date.parse(d.lastSeenAt)
          : -Infinity
    return [...filtered].sort((a, b) => (value(a) - value(b)) * dir)
  }, [filtered, sortKey, order])

  const pageCount = Math.max(1, Math.ceil(sorted.length / size))
  const safePage = Math.min(page, pageCount)
  const pageRows = sorted.slice((safePage - 1) * size, safePage * size)

  const isFiltered = query.trim() !== "" || statusFilter !== "any"

  const setSearch = (value: string) => {
    setQuery(value)
    setPage(1)
  }
  const setStatus = (next: DeviceStatus | "any") => {
    setStatusFilter(next)
    setPage(1)
  }
  const clearFilters = () => {
    setQuery("")
    setStatusFilter("any")
    setPage(1)
  }
  const onToggleSort = (columnId: string) => {
    const key = columnId as SortKey
    if (key === sortKey) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setOrder("desc")
    }
    setPage(1)
  }

  const allPageSelected =
    pageRows.length > 0 && pageRows.every((d) => selected.has(d.id))
  const somePageSelected =
    pageRows.some((d) => selected.has(d.id)) && !allPageSelected

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allPageSelected) {
        for (const d of pageRows) next.delete(d.id)
      } else {
        for (const d of pageRows) next.add(d.id)
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
      csvHeader: "Device",
      csvValue: (device) =>
        device.name ? `${device.name} (${device.serial})` : device.serial,
    },
    {
      id: "status",
      header: "Status",
      cell: (device) => (
        <StatusDot color={DEVICE_STATUS_COLOR[device.status]} label={device.status} />
      ),
      csvValue: (device) => device.status,
    },
    {
      id: "firmware",
      header: "Firmware",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (device) => device.firmwareVersion ?? "—",
      csvValue: (device) => device.firmwareVersion ?? "",
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
      csvHeader: "Model",
      csvValue: (device) => device.deviceModelId,
    },
    {
      id: "lastSeenAt",
      header: "Last seen",
      sortable: true,
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
      csvHeader: "Last seen",
      csvValue: (device) => device.lastSeenAt ?? "",
    },
    {
      id: "createdAt",
      header: "Created",
      sortable: true,
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (device) => formatDate(device.createdAt),
      csvHeader: "Created",
      csvValue: (device) => device.createdAt,
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
          <DropdownMenuItem key={opt} onSelect={() => setStatus(opt)}>
            {opt}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-0 min-w-0 flex-col gap-6 p-4 pt-0 group-has-data-[collapsible=icon]/sidebar-wrapper:h-[calc(100svh-3rem)]">
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
            <Button variant="default" size="lg" onClick={handleProvision}>
              <PlusIcon />
              Register device
            </Button>
          </div>
        </header>
      </StickyHeader>

      {isLoading && !error ? (
        <DevicesKpiSkeleton />
      ) : fleet ? (
        <DevicesKpi devices={fleet} />
      ) : null}

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <DataTable
          fillHeight
          className="min-h-0 flex-1"
          columns={columns}
          rows={pageRows}
          getRowKey={(device) => device.id}
          loading={isLoading}
          skeletonRows={6}
          isFiltered={isFiltered}
          sort={sortKey ? { columnId: sortKey, dir: order } : undefined}
          onToggleSort={onToggleSort}
          selection={{
            isSelected: (d) => selected.has(d.id),
            onToggle: (d) => toggleOne(d.id),
            allSelected: allPageSelected,
            someSelected: somePageSelected,
            onToggleAll: toggleAll,
            rowLabel: (d) => `Select ${d.serial}`,
          }}
          toolbar={
            <DataTableToolbar
              search={{
                value: query,
                onChange: setSearch,
                placeholder: "Filter by name or serial…",
              }}
              searchAlign="right"
              filters={statusFilterMenu}
            />
          }
          pagination={{
            page: safePage,
            pageSize: size,
            total: sorted.length,
            rowsOnPage: pageRows.length,
            pageSizes: PAGE_SIZES,
            onPageChange: setPage,
            onPageSizeChange: (s) => {
              setSize(s)
              setPage(1)
            },
          }}
          exportCsv={{
            filename: `devices-${new Date().toISOString().slice(0, 10)}.csv`,
            getRows: () => sorted,
          }}
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
