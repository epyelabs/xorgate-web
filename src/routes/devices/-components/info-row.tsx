import { cn } from "@/lib/utils"

// A labelled read-only value cell used in the device settings info grids.
//
// `action` is an optional control rendered inline after the value (the agent
// version's update button, device_update_management Phase 4). It sits INSIDE
// the dd, beside the value, so the cell keeps its grid footprint — a row given
// its own action column would misalign every other row in the grid.
export function InfoRow({
  label,
  value,
  mono,
  action,
  title,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
  action?: React.ReactNode
  title?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span className={cn("truncate", mono && "font-mono")} title={title}>
          {value}
        </span>
        {action}
      </dd>
    </div>
  )
}
