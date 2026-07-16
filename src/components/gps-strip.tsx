import {
  CircleDotIcon,
  CrosshairIcon,
  GaugeIcon,
  LocateFixedIcon,
  MountainIcon,
  SatelliteDishIcon,
  SatelliteIcon,
  type LucideIcon,
} from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { IoCapabilities } from "@/lib/api"
import type { LatestReading } from "@/hooks/use-iot-telemetry"
import { gpsMetrics } from "@/lib/capability-metrics"
import { formatMetricValue, formatUnit, metricLabel } from "@/lib/telemetry-meta"

// Metric key → icon. Keeps the strip label-free so it stays narrow enough to
// float over the map; the full label surfaces in the tooltip.
const METRIC_ICONS: Record<string, LucideIcon> = {
  "gps.alt": MountainIcon,
  "gps.speed": GaugeIcon,
  "gps.satellites": SatelliteIcon,
  "gps.satellites_in_view": SatelliteDishIcon,
  "gps.fix_quality": LocateFixedIcon,
  "gps.hdop": CrosshairIcon,
}

// Widest value each metric can display, in characters (digits + sign + dot).
// tabular-nums makes every digit exactly 1ch, so reserving this many `ch` gives
// the number a fixed width it can never exceed — the strip never changes width
// as values stream in, which would be very visible floating over a moving map.
function reserveCh(metric: string): number {
  switch (metric) {
    case "gps.fix_quality":
      return 1 // 0–8
    case "gps.satellites":
    case "gps.satellites_in_view":
      return 2 // 0–99
    case "gps.hdop":
      return 4 // 6.10
    case "gps.alt":
      return 6 // 1256.3
    default:
      return 5 // speed: 100.0
  }
}

// The number and unit sit tight against each other (readable), and the reserved
// slack is pushed to a trailing spacer sized to the leftover characters. So the
// chip's width stays constant regardless of the value's length (no reflow) while
// the value+unit never drift apart.
function StableValue({
  metric,
  reading,
}: {
  metric: string
  reading?: LatestReading
}) {
  const text = reading ? formatMetricValue(reading.value, metric) : "—"
  const pad = Math.max(0, reserveCh(metric) - text.length)
  return (
    <span className="inline-flex items-baseline">
      <span className="font-medium tabular-nums">{text}</span>
      {reading?.unit ? (
        <span className="ml-0.5 text-xs font-normal text-muted-foreground">
          {formatUnit(reading.unit)}
        </span>
      ) : null}
      {pad > 0 ? (
        <span aria-hidden className="inline-block" style={{ width: `${pad}ch` }} />
      ) : null}
    </span>
  )
}

/**
 * Compact GPS readout that floats over the Map View. Renders each GPS metric the
 * device produces as an icon + value chip, with the name in a tooltip. lat/lon
 * are omitted: the marker on the map already represents the position, so this
 * strip carries only what the marker cannot say (altitude, speed, fix quality).
 */
export function GpsStrip({
  caps,
  latest,
}: {
  caps: IoCapabilities | null
  latest: Record<string, LatestReading>
}) {
  const metrics = gpsMetrics(caps).filter(
    (m) => m !== "gps.lat" && m !== "gps.lon"
  )
  if (metrics.length === 0) return null

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex max-w-full items-center gap-3 overflow-x-auto rounded-full border bg-background/85 px-3.5 py-2 shadow-sm backdrop-blur-sm">
        {metrics.map((m) => {
          const Icon = METRIC_ICONS[m] ?? CircleDotIcon
          return (
            <Tooltip key={m}>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 text-sm whitespace-nowrap">
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <StableValue metric={m} reading={latest[m]} />
                </div>
              </TooltipTrigger>
              <TooltipContent>{metricLabel(m)}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}
