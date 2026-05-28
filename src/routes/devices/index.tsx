import { useEffect, useMemo, useState } from "react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  ChevronDownIcon,
  FileDownIcon,
  FilterIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
import { listDevices, type Device, type DeviceStatus } from "@/lib/api"
import { listDevicesResponseSchema } from "@/lib/schemas"
import { formatRelative } from "@/lib/relative-time"
import { useAuthStore } from "@/store/auth"
import { useWorkspaceStore } from "@/store/workspace"
import { DevicesKpi, DevicesKpiSkeleton } from "./-components/devices-kpi"
import {
  ColHead,
  DevicesTableSkeleton,
  EmptyState,
  FilteredEmptyState,
  StatusCell,
} from "./-components/devices-table-parts"

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
  projectId: string | null
  devices: Device[]
}

function DevicesListPage() {
  const [data, setData] = useState<DevicesData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<DeviceStatus | "any">("any")
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId)
  const currentProject = useWorkspaceStore((s) =>
    s.projects.find((p) => p.id === s.currentProjectId)
  )

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
        setData({ projectId: currentProjectId, devices: parsed.data.devices })
        setSelected(new Set())
      } catch (err) {
        const message = (err as Error).message
        if (cancelled) return
        setError(message)
        setData({ projectId: currentProjectId, devices: [] })
        toast.error(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [currentProjectId])

  const isLoading = !data || data.projectId !== currentProjectId
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

  const handleProvision = () => toast.info("Provisioning flow coming soon")

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <header className="flex flex-wrap items-start gap-4">
        <div className="flex flex-col gap-1">
          {/* {currentProject ? (
            <span className="text-[10px] tracking-[0.14em] uppercase text-muted-foreground">
              Project · {currentProject.name.toUpperCase()}
            </span>
          ) : null} */}
          <h1 className="text-2xl font-semibold tracking-tight">Devices</h1>
          <p className="text-sm text-muted-foreground">
            Physical units in the field. Status reflects the last heartbeat from
            the edge SDK.
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
            Provision device
          </Button>
        </div>
      </header>

      {isLoading && !error ? (
        <DevicesKpiSkeleton />
      ) : devices ? (
        <DevicesKpi devices={devices} />
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name or serial…"
              className="pl-7"
            />
          </div>
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
                <DropdownMenuItem
                  key={opt}
                  onSelect={() => setStatusFilter(opt)}
                >
                  {opt}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {devices ? (
            <span className="ml-auto text-xs text-muted-foreground">
              Showing {filtered.length} of {devices.length}
            </span>
          ) : null}
        </div>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : isLoading ? (
          <DevicesTableSkeleton />
        ) : devices && devices.length === 0 ? (
          <EmptyState onProvision={handleProvision} />
        ) : filtered.length === 0 ? (
          <FilteredEmptyState onClear={clearFilters} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 pl-3">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    className="size-3.5 cursor-pointer align-middle accent-primary"
                    checked={allFilteredSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someFilteredSelected
                    }}
                    onChange={toggleAll}
                  />
                </TableHead>
                <ColHead>Device</ColHead>
                <ColHead>Status</ColHead>
                <ColHead>Firmware</ColHead>
                <ColHead>Model</ColHead>
                <ColHead>Last seen</ColHead>
                <ColHead>Created</ColHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((device) => (
                <TableRow
                  key={device.id}
                  data-state={selected.has(device.id) ? "selected" : undefined}
                >
                  <TableCell className="w-8 pl-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${device.serial}`}
                      className="size-3.5 cursor-pointer align-middle accent-primary"
                      checked={selected.has(device.id)}
                      onChange={() => toggleOne(device.id)}
                    />
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                  <TableCell>
                    <StatusCell status={device.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {device.firmwareVersion ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default font-mono">
                          {shortId(device.deviceModelId)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{device.deviceModelId}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default">
                          {formatRelative(device.lastSeenAt)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {formatTimestamp(device.lastSeenAt)}
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {formatDate(device.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
