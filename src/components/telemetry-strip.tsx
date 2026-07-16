import { Fragment, useState } from "react"
import {
  CircleDotIcon,
  CompassIcon,
  CpuIcon,
  GaugeIcon,
  HardDriveIcon,
  LocateFixedIcon,
  MemoryStickIcon,
  MountainIcon,
  Move3dIcon,
  RadioIcon,
  Rotate3dIcon,
  SatelliteIcon,
  SignalHighIcon,
  ThermometerIcon,
  type LucideIcon,
} from "lucide-react"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { IoCapabilities } from "@/lib/api"
import type { LatestReading } from "@/hooks/use-iot-telemetry"
import {
  gpsMetrics,
  imuAccelMetrics,
  imuEulerMetrics,
  imuQuaternionMetrics,
  signalMetrics,
  systemMetrics,
} from "@/lib/capability-metrics"
import { formatMetricValue, formatUnit, metricLabel } from "@/lib/telemetry-meta"

// Metric key → icon. Keeps the strip label-free to save horizontal space; the
// full label surfaces in the tooltip.
const METRIC_ICONS: Record<string, LucideIcon> = {
  "gps.alt": MountainIcon,
  "gps.speed": GaugeIcon,
  "gps.satellites": SatelliteIcon,
  "gps.fix_quality": LocateFixedIcon,
  "system.cpu_usage": CpuIcon,
  "system.cpu_temp": ThermometerIcon,
  "system.ram_usage": MemoryStickIcon,
  "system.disk_usage": HardDriveIcon,
  "lte.rssi": SignalHighIcon,
  "lte.quality": RadioIcon,
}

// Widest value each metric can display, in characters (digits + sign + dot).
// tabular-nums makes every digit exactly 1ch, so reserving this many `ch` gives
// the number a fixed width it can never exceed — no reflow as digits stream in —
// while staying tight for short metrics (satellites, fix quality).
function reserveCh(metric: string): number {
  if (metric.startsWith("imu.quat_")) return 7 // -0.7071
  if (metric.startsWith("imu.euler_")) return 6 // -180.0
  if (metric.startsWith("imu.accel_")) return 6 // -12.34
  switch (metric) {
    case "gps.fix_quality":
      return 1 // 0–8
    case "gps.satellites":
    case "lte.quality":
      return 2 // 0–31
    case "lte.rssi":
      return 4 // -105
    case "gps.alt":
      return 6 // 1256.3
    default:
      return 5 // percentages / speed: 100.0
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
        <span className="ml-0.5 text-[0.65rem] font-normal text-muted-foreground">
          {formatUnit(reading.unit)}
        </span>
      ) : null}
      {pad > 0 ? (
        <span aria-hidden className="inline-block" style={{ width: `${pad}ch` }} />
      ) : null}
    </span>
  )
}

function MetricChip({
  metric,
  reading,
}: {
  metric: string
  reading?: LatestReading
}) {
  const Icon = METRIC_ICONS[metric] ?? CircleDotIcon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1 text-xs whitespace-nowrap">
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <StableValue metric={metric} reading={reading} />
        </div>
      </TooltipTrigger>
      <TooltipContent>{metricLabel(metric)}</TooltipContent>
    </Tooltip>
  )
}

// IMU sub-metrics are distinguished by axis/component (x/y/z, r/i/j/k, roll/
// pitch/yaw). A single-letter tag identifies each without a verbose label; the
// tooltip carries the full name.
function axisTag(metric: string): string {
  const field = metric.split(".")[1] ?? metric
  const seg = field.split("_").pop() ?? field
  return seg.charAt(0).toUpperCase()
}

function ImuChip({
  metric,
  reading,
}: {
  metric: string
  reading?: LatestReading
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1 text-xs whitespace-nowrap">
          <span className="w-2.5 text-center text-[0.65rem] font-semibold text-muted-foreground/70 uppercase">
            {axisTag(metric)}
          </span>
          <StableValue metric={metric} reading={reading} />
        </div>
      </TooltipTrigger>
      <TooltipContent>{metricLabel(metric)}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Compact single-row telemetry readout for the Map View. Renders each metric
 * the device produces as an icon + value chip (lat/lon are omitted — the map
 * marker represents position), grouped by subsystem with thin dividers. The IMU
 * group shows one sub-mode at a time (Orientation / Euler / Acceleration) with a
 * button to switch between the ones the device supports. Values come from the
 * same live `latest` object the card view uses.
 */
export function TelemetryStrip({
  caps,
  latest,
}: {
  caps: IoCapabilities | null
  latest: Record<string, LatestReading>
}) {
  const staticGroups = [
    {
      key: "gps",
      metrics: gpsMetrics(caps).filter(
        (m) => m !== "gps.lat" && m !== "gps.lon"
      ),
    },
    { key: "system", metrics: systemMetrics(caps) },
    { key: "signal", metrics: signalMetrics(caps) },
  ].filter((g) => g.metrics.length > 0)

  const imuModes = [
    {
      key: "orientation",
      label: "Orient",
      Icon: Rotate3dIcon,
      metrics: imuQuaternionMetrics(caps),
    },
    {
      key: "euler",
      label: "Euler",
      Icon: CompassIcon,
      metrics: imuEulerMetrics(caps),
    },
    {
      key: "accel",
      label: "Accel",
      Icon: Move3dIcon,
      metrics: imuAccelMetrics(caps),
    },
  ].filter((m) => m.metrics.length > 0)

  const [imuIdx, setImuIdx] = useState(0)
  const currentImu =
    imuModes.length > 0 ? imuModes[imuIdx % imuModes.length] : null

  if (staticGroups.length === 0 && imuModes.length === 0) return null

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border bg-background/85 px-2.5 py-1.5 shadow-sm backdrop-blur-sm">
        {staticGroups.map((g, gi) => (
          <Fragment key={g.key}>
            {gi > 0 ? (
              <Separator orientation="vertical" className="h-5" />
            ) : null}
            <div className="flex items-center gap-2.5">
              {g.metrics.map((m) => (
                <MetricChip key={m} metric={m} reading={latest[m]} />
              ))}
            </div>
          </Fragment>
        ))}

        {currentImu ? (
          <>
            {staticGroups.length > 0 ? (
              <Separator orientation="vertical" className="h-5" />
            ) : null}
            <div className="flex items-center gap-1.5">
              {imuModes.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setImuIdx((i) => (i + 1) % imuModes.length)}
                  title="Switch IMU metric"
                  className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <currentImu.Icon className="size-3.5" />
                  {currentImu.label}
                </button>
              ) : (
                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <currentImu.Icon className="size-3.5" />
                  {currentImu.label}
                </span>
              )}
              {currentImu.metrics.map((m) => (
                <ImuChip key={m} metric={m} reading={latest[m]} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </TooltipProvider>
  )
}
