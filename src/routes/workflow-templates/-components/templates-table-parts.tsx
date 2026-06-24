import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { TemplateStatus } from "@/lib/workflow-schemas"

const STATUS_DOT: Record<TemplateStatus, string> = {
  published: "bg-emerald-500",
  draft: "bg-amber-500",
}

export function TemplateStatusCell({ status }: { status: TemplateStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} />
      <span className="text-xs">{status}</span>
    </span>
  )
}

export function ColHead({ children }: { children: React.ReactNode }) {
  return (
    <TableHead className="text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
      {children}
    </TableHead>
  )
}

export function TemplatesTableSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <ColHead>Name</ColHead>
          <ColHead>Status</ColHead>
          <ColHead>Version</ColHead>
          <ColHead>Used by</ColHead>
          <ColHead>Created by</ColHead>
          <ColHead>Updated</ColHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 4 }).map((_, i) => (
          <TableRow key={i}>
            <TableCell>
              <Skeleton className="h-4 w-44" />
              <Skeleton className="mt-1 h-3 w-56" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-16" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-8" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-16" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-24" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-4 w-12" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">No workflow templates yet</p>
        <p className="text-xs text-muted-foreground">
          Build a reusable intelligence pipeline and deploy it onto your devices.
        </p>
      </div>
      <Button variant="default" size="sm" onClick={onCreate}>
        <PlusIcon />
        New template
      </Button>
    </div>
  )
}

export function FilteredEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
      <p className="text-sm text-muted-foreground">
        No templates match the current filters.
      </p>
      <Button variant="link" size="sm" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  )
}
