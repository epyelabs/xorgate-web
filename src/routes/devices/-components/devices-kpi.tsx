import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { Device } from "@xorgate/sdk"
import { isOlderThan } from "@/lib/relative-time"

const DAY_MS = 24 * 60 * 60 * 1000

interface Stat {
  label: string
  value: number
}

function computeStats(devices: Device[]): Stat[] {
  let online = 0
  let provisioned = 0
  let decommissioned = 0
  let offlineOver24h = 0
  for (const d of devices) {
    if (d.status === "online") online++
    else if (d.status === "provisioned") provisioned++
    else if (d.status === "decommissioned") decommissioned++
    if (d.status !== "online" && isOlderThan(d.lastSeenAt, DAY_MS)) {
      offlineOver24h++
    }
  }
  return [
    { label: "Total", value: devices.length },
    { label: "Online", value: online },
    { label: "Offline >24h", value: offlineOver24h },
    { label: "Provisioned", value: provisioned },
    { label: "Decommissioned", value: decommissioned },
  ]
}

function KpiCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-2">
        <span className="text-[10px] tracking-[0.14em] uppercase text-muted-foreground">
          {label}
        </span>
        <span className="text-3xl font-semibold tabular-nums leading-none">
          {value}
        </span>
      </CardContent>
    </Card>
  )
}

export function DevicesKpi({ devices }: { devices: Device[] }) {
  const stats = computeStats(devices)
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {stats.map((s) => (
        <KpiCard key={s.label} label={s.label} value={s.value} />
      ))}
    </div>
  )
}

export function DevicesKpiSkeleton() {
  const labels = ["Total", "Online", "Offline >24h", "Provisioned", "Decommissioned"]
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {labels.map((label) => (
        <KpiCard key={label} label={label} value={<Skeleton className="h-7 w-12" />} />
      ))}
    </div>
  )
}
