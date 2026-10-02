import { useCallback, useEffect, useMemo, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { requireWorkspace } from "@/lib/auth-guard"
import {
  ArrowRightLeftIcon,
  ChevronDownIcon,
  FilterIcon,
  FlaskConicalIcon,
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
import { Badge } from "@/components/ui/badge"
import { xgMessage } from "@/lib/xorgate"
import type { Device, DeviceStatus } from "@xorgate/sdk"

import { formatRelative } from "@/lib/relative-time"
import { useWorkspaceStore } from "@/store/workspace"
import { useDeviceModels, useFleet, useInvalidateDevices } from "@/queries/devices"
import { useHasPermission } from "@/lib/permissions"
import { presenceDeviceIds, useLiveDeviceStatuses } from "@/store/presence"
import { DevicePresence } from "@/components/device-presence"
import { StickyHeader } from "@/components/sticky-header"
import { DevicesKpi, DevicesKpiSkeleton } from "./-components/devices-kpi"
import { ProvisionDeviceDialog } from "./-components/provision-device-dialog"
import { RegisterSimulationDialog } from "./-components/register-simulation-dialog"
import { SimulatedBadge } from "./-components/simulated-badge"
import { BulkTransferDialog } from "./-components/bulk-transfer-dialog"

export const Route = createFileRoute("/devices/")({
  beforeLoad: requireWorkspace,
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

// Real hardware vs simulated devices (plans/xorgate-device-simulator). A
// client filter over the fleet query rather than `devices.list({simulated})`:
// the fleet query already holds every row (the KPI tiles need them all) and
// each carries `simulated`, so this costs no request, composes with the status
// filter and the search, and cannot disagree with the rows on screen.
type KindFilter = "any" | "real" | "simulated"
const KIND_OPTIONS: readonly KindFilter[] = ["any", "real", "simulated"]

const DEVICE_STATUS_COLOR: Record<DeviceStatus, string> = {
  online: "bg-emerald-500",
  offline: "bg-amber-500",
  provisioned: "bg-sky-500",
  decommissioned: "bg-zinc-400",
}

type SortKey = "lastSeenAt" | "createdAt"
const PAGE_SIZES = [25, 50, 100]
const DEFAULT_SIZE = 25

const NO_DEVICES: Device[] = []

function DevicesListPage() {
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<DeviceStatus | "any">("any")
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [kindFilter, setKindFilter] = useState<KindFilter>("any")
  const [provisionOpen, setProvisionOpen] = useState(false)
  const [simulationOpen, setSimulationOpen] = useState(false)
  const canSimulate = useHasPermission("devices:simulate")
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [order, setOrder] = useState<"asc" | "desc">("desc")
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)

  // Same freshness contract as the device layout: polled while visible,
  // refetched on return, and every row on the page watched over MQTT so the
  // status column flips the moment a device comes back rather than at the
  // next poll. The query key carries the workspace id, so switching
  // workspaces switches to (or starts) that workspace's own cache entry —
  // the old "stale workspace = loading" comparison is gone with the effect.
  const fleetQuery = useFleet({ poll: true })
  const roster = fleetQuery.data ?? NO_DEVICES
  const isLoading = fleetQuery.isPending
  // A failed background poll keeps the last good fleet on screen; only a
  // fetch with nothing behind it is an error worth the operator's attention.
  const error =
    fleetQuery.data || !fleetQuery.error ? null : xgMessage(fleetQuery.error)

  // Model id → name, for the Model column (the platform-wide catalog is
  // tiny). Best-effort: on failure the column falls back to the short id.
  const modelsQuery = useDeviceModels()
  const modelNames = useMemo(
    () =>
      Object.fromEntries((modelsQuery.data ?? []).map((m) => [m.id, m.name])),
    [modelsQuery.data]
  )

  // Selection and page are per-workspace concerns; reset them on switch.
  useEffect(() => {
    setSelected(new Set())
    setPage(1)
  }, [currentWorkspaceId])

  // Presence overlay over the polled roster (see store/presence.ts).
  const fleet = useLiveDeviceStatuses(roster)

  // Status filter + name/serial search (client-side over the whole fleet).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return fleet.filter((d) => {
      if (statusFilter !== "any" && d.status !== statusFilter) return false
      if (kindFilter !== "any" && d.simulated !== (kindFilter === "simulated"))
        return false
      if (!q) return true
      return (
        d.serial.toLowerCase().includes(q) ||
        (d.name ?? "").toLowerCase().includes(q)
      )
    })
  }, [fleet, query, statusFilter, kindFilter])

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

  // Live feeds for the rows on screen only: one MQTT connection per device,
  // so the page, not the whole fleet, is the honest bound. Watched ids come
  // from the polled roster, not the overlay, so presence can't keep itself
  // alive.
  const watched = useMemo(
    () =>
      presenceDeviceIds(
        roster.filter((d) => pageRows.some((row) => row.id === d.id))
      ),
    [roster, pageRows]
  )

  const isFiltered =
    query.trim() !== "" || statusFilter !== "any" || kindFilter !== "any"

  const setSearch = (value: string) => {
    setQuery(value)
    setPage(1)
  }
  const setStatus = (next: DeviceStatus | "any") => {
    setStatusFilter(next)
    setPage(1)
  }
  const setKind = (next: KindFilter) => {
    setKindFilter(next)
    setPage(1)
  }
  const clearFilters = () => {
    setQuery("")
    setStatusFilter("any")
    setKindFilter("any")
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

  // Q5: same-organization bulk transfer, driven off the selection the table
  // already keeps. Cross-organization stays one device at a time — it needs a
  // handshake, and a handshake per device in a batch is not a batch.
  const canTransfer = useHasPermission("devices:transfer")
  const [bulkTransferOpen, setBulkTransferOpen] = useState(false)
  const selectedDevices = useMemo(
    () => fleet.filter((d) => selected.has(d.id)),
    [fleet, selected]
  )

  const handleProvision = () => setProvisionOpen(true)
  // Stable so it doesn't churn the dialog's polling effect. Refreshes the
  // fleet once a registration is claimed so the new device appears.
  const invalidateDevices = useInvalidateDevices()
  const handleClaimed = useCallback(
    () => invalidateDevices(),
    [invalidateDevices]
  )

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
          <span className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-foreground hover:underline">
              {device.name ?? device.serial}
            </span>
            {device.simulated ? <SimulatedBadge config={device.config} /> : null}
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
      id: "agentVersion",
      header: "Agent version",
      cellClassName: "text-muted-foreground tabular-nums",
      // Mirrored cloud-side from the device's own report, so a device that has
      // never connected (or runs an agent older than the build manifest) reads
      // "—" rather than a value someone typed.
      cell: (device) => device.agentVersion ?? "—",
      csvValue: (device) => device.agentVersion ?? "",
    },
    {
      id: "model",
      header: "Model",
      cellClassName: "text-muted-foreground",
      cell: (device) => {
        const name = modelNames[device.deviceModelId]
        return (
          <span className="inline-flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={name ? "cursor-default" : "cursor-default font-mono"}>
                  {name ?? shortId(device.deviceModelId)}
                </span>
              </TooltipTrigger>
              <TooltipContent>{device.deviceModelId}</TooltipContent>
            </Tooltip>
            {device.needsModel ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="border-amber-500/50 text-amber-600 dark:text-amber-400"
                  >
                    needs model
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  The device's hardware probe could not pick a model; confirm
                  one on the device page.
                </TooltipContent>
              </Tooltip>
            ) : null}
          </span>
        )
      },
      csvHeader: "Model",
      csvValue: (device) =>
        modelNames[device.deviceModelId] ?? device.deviceModelId,
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

  const kindFilterMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" data-testid="kind-filter">
          <FilterIcon />
          type: {kindFilter}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {KIND_OPTIONS.map((opt) => (
          <DropdownMenuItem key={opt} onSelect={() => setKind(opt)}>
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
            {canSimulate ? (
              <Button
                variant="outline"
                size="lg"
                onClick={() => setSimulationOpen(true)}
              >
                <FlaskConicalIcon />
                Register simulation
              </Button>
            ) : null}
            <Button variant="brand" size="lg" onClick={handleProvision}>
              <PlusIcon />
              Register device
            </Button>
          </div>
        </header>
      </StickyHeader>

      <DevicePresence deviceIds={watched} />

      {isLoading && !error ? (
        <DevicesKpiSkeleton />
      ) : !isLoading ? (
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
              filters={
                <>
                  {statusFilterMenu}
                  {kindFilterMenu}
                </>
              }
            >
              {/* Only while rows are selected: an always-on bulk control is a
                  button that spends most of its life disabled. */}
              {canTransfer && selectedDevices.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBulkTransferOpen(true)}
                >
                  <ArrowRightLeftIcon />
                  Transfer {selectedDevices.length} to workspace
                </Button>
              ) : null}
            </DataTableToolbar>
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
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="brand" size="sm" onClick={handleProvision}>
                  <PlusIcon />
                  Register device
                </Button>
                {canSimulate ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSimulationOpen(true)}
                  >
                    <FlaskConicalIcon />
                    Register simulation
                  </Button>
                ) : null}
              </div>
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

      <RegisterSimulationDialog
        open={simulationOpen}
        onOpenChange={setSimulationOpen}
        onCreated={handleClaimed}
      />

      <BulkTransferDialog
        open={bulkTransferOpen}
        onOpenChange={setBulkTransferOpen}
        devices={selectedDevices}
        onDone={() => setSelected(new Set())}
      />
    </div>
  )
}
