import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { PlusIcon } from "lucide-react"
import type { DeviceStatus } from "@/lib/api"

const STATUS_DOT: Record<DeviceStatus, string> = {
  online: "bg-emerald-500",
  offline: "bg-amber-500",
  provisioned: "bg-sky-500",
  decommissioned: "bg-zinc-400",
}

export function StatusCell({ status }: { status: DeviceStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} />
      <span className="text-xs">{status}</span>
    </span>
  )
}

export function ColHead({ children }: { children: React.ReactNode }) {
  return (
    <TableHead className="text-[10px] tracking-[0.14em] uppercase text-muted-foreground">
      {children}
    </TableHead>
  )
}

export function DevicesTableSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8 pl-3" />
          <ColHead>Device</ColHead>
          <ColHead>Status</ColHead>
          <ColHead>Firmware</ColHead>
          <ColHead>Model</ColHead>
          <ColHead>Last seen</ColHead>
          <ColHead>Created</ColHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 6 }).map((_, i) => (
          <TableRow key={i}>
            <TableCell className="w-8 pl-3">
              <Skeleton className="size-3.5" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-1 h-3 w-24" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-16" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-14" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-20" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-10" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-24" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function EmptyState({ onProvision }: { onProvision: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">No devices yet</p>
        <p className="text-xs text-muted-foreground">
          Provision your first device to start streaming.
        </p>
      </div>
      <Button variant="default" size="sm" onClick={onProvision}>
        <PlusIcon />
        Provision device
      </Button>
    </div>
  )
}

export function FilteredEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
      <p className="text-sm text-muted-foreground">
        No devices match the current filters.
      </p>
      <Button variant="link" size="sm" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  )
}
