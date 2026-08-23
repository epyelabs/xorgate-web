import { Fragment, useEffect, useRef, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { toast } from "sonner"
import { xg, xgMessage } from "@/lib/xorgate"
import type { IoCapabilities } from "@xorgate/sdk"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import { gpsMetrics, imuMetrics, signalMetrics } from "@/lib/capability-metrics"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export const Route = createFileRoute("/devices/$id/benchmark")({
  beforeLoad: requireAuth,
  component: DeviceBenchmarkPage,
})

// --- Benchmark module catalogue ----------------------------------------------
// Each hardware module the on-device agent manages maps to a benchmark card.
// `available(caps)` gates the card on the device model's ioCapabilities, reusing
// the same capability helpers the live/history screens use. System and Network
// are always present (the agent always reports them). Mock metric ranges below
// drive the simulated results — nothing here runs on the real device yet.

type BenchMetric = {
  key: string
  label: string
  unit: string
  min: number
  max: number
  decimals?: number
}

type BenchModule = {
  key: string
  label: string
  description: string
  metrics: BenchMetric[]
  available: (caps: IoCapabilities | null) => boolean
}

const MODULES: BenchModule[] = [
  {
    key: "system",
    label: "System",
    description: "CPU, memory and storage stress test.",
    available: () => true,
    metrics: [
      {
        key: "cpu_score",
        label: "CPU stress score",
        unit: "pts",
        min: 4200,
        max: 9800,
      },
      {
        key: "mem_bw",
        label: "Memory bandwidth",
        unit: "GB/s",
        min: 2.1,
        max: 6.4,
        decimals: 1,
      },
      {
        key: "disk_write",
        label: "Disk write",
        unit: "MB/s",
        min: 35,
        max: 180,
      },
    ],
  },
  {
    key: "network",
    label: "Network",
    description: "Interface reachability and throughput.",
    available: () => true,
    metrics: [
      { key: "ping", label: "Ping latency", unit: "ms", min: 8, max: 120 },
      {
        key: "down",
        label: "Download",
        unit: "Mb/s",
        min: 4,
        max: 95,
        decimals: 1,
      },
      {
        key: "ifaces",
        label: "Reachable interfaces",
        unit: "",
        min: 1,
        max: 3,
      },
    ],
  },
  {
    key: "imu",
    label: "IMU (BNO085)",
    description: "I2C sample rate and read latency.",
    available: (caps) => imuMetrics(caps).length > 0,
    metrics: [
      { key: "rate", label: "Sample rate", unit: "Hz", min: 80, max: 110 },
      {
        key: "latency",
        label: "I2C read latency",
        unit: "ms",
        min: 0.8,
        max: 4.5,
        decimals: 1,
      },
      {
        key: "jitter",
        label: "Jitter",
        unit: "ms",
        min: 0.1,
        max: 1.8,
        decimals: 1,
      },
    ],
  },
  {
    key: "gps",
    label: "GPS",
    description: "Fix acquisition and NMEA parsing.",
    available: (caps) => gpsMetrics(caps).length > 0,
    metrics: [
      {
        key: "fix",
        label: "Fix acquisition",
        unit: "s",
        min: 1.2,
        max: 38,
        decimals: 1,
      },
      { key: "nmea", label: "NMEA parse rate", unit: "/s", min: 5, max: 30 },
      { key: "sats", label: "Satellites", unit: "", min: 4, max: 14 },
    ],
  },
  {
    key: "lte",
    label: "LTE / Signal",
    description: "Modem signal strength and poll latency.",
    available: (caps) => signalMetrics(caps).length > 0,
    metrics: [
      { key: "rssi", label: "RSSI", unit: "dBm", min: -110, max: -61 },
      { key: "csq", label: "CSQ poll latency", unit: "ms", min: 20, max: 240 },
      { key: "quality", label: "Quality", unit: "ASU", min: 5, max: 31 },
    ],
  },
  {
    key: "media",
    label: "Camera / Media",
    description: "KVS WebRTC stream startup and encode.",
    available: (caps) => (caps?.media?.video?.length ?? 0) > 0,
    metrics: [
      {
        key: "startup",
        label: "Stream startup",
        unit: "ms",
        min: 600,
        max: 4200,
      },
      { key: "fps", label: "Encode rate", unit: "fps", min: 12, max: 30 },
      {
        key: "stability",
        label: "Channel stability",
        unit: "%",
        min: 82,
        max: 100,
      },
    ],
  },
]

type RunStatus = "idle" | "running" | "passed" | "failed"

type ModuleState = {
  status: RunStatus
  progress: number
  results: Record<string, number> | null
}

const IDLE: ModuleState = { status: "idle", progress: 0, results: null }

function initialStates(): Record<string, ModuleState> {
  const init: Record<string, ModuleState> = {}
  for (const m of MODULES) init[m.key] = IDLE
  return init
}

function formatValue(value: number, decimals = 0): string {
  return value.toFixed(decimals)
}

// Plain helper (not a component) so this route file keeps a single exported
// component, which the react-refresh lint rule requires.
function statusBadge(status: RunStatus) {
  switch (status) {
    case "running":
      return <Badge variant="secondary">Running</Badge>
    case "passed":
      return <Badge variant="default">Passed</Badge>
    case "failed":
      return <Badge variant="destructive">Failed</Badge>
    default:
      return <Badge variant="outline">Idle</Badge>
  }
}

function DeviceBenchmarkPage() {
  const { id } = Route.useParams()
  const [caps, setCaps] = useState<IoCapabilities | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [states, setStates] =
    useState<Record<string, ModuleState>>(initialStates)
  const timersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})

  // Fetch device → model, same shape as the streams tab, to read ioCapabilities.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const device = await xg().devices.get(id)
        if (cancelled) return
        useBreadcrumbStore
          .getState()
          .setDeviceName(device.name ?? device.serial)

        const model = await xg().deviceModels.get(device.deviceModelId)
        if (!cancelled) setCaps(model.ioCapabilities)
      } catch (err) {
        const message = xgMessage(err)
        if (!cancelled) {
          setLoadError(message)
          toast.error(message)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  // Clear any in-flight simulated runs when leaving the tab.
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const t of Object.values(timers)) clearInterval(t)
    }
  }, [])

  // Until capabilities load (or if they fail to), show every module so the
  // screen is never empty in dev; once loaded, gate on what the model declares.
  const visibleModules = MODULES.filter((m) =>
    caps === null ? true : m.available(caps)
  )

  // Simulated run: advance a local progress counter on a timer, then fill mock
  // results. Random values live in the timer callback (not in a state updater)
  // so React StrictMode's double-invoked updaters stay pure.
  function runModule(key: string) {
    const existing = timersRef.current[key]
    if (existing) clearInterval(existing)

    setStates((prev) => ({
      ...prev,
      [key]: { status: "running", progress: 0, results: null },
    }))

    let progress = 0
    const timer = setInterval(() => {
      progress = Math.min(100, progress + (Math.random() * 14 + 6))
      if (progress >= 100) {
        clearInterval(timer)
        delete timersRef.current[key]
        const mod = MODULES.find((m) => m.key === key)
        const results: Record<string, number> = {}
        for (const metric of mod?.metrics ?? []) {
          results[metric.key] =
            metric.min + Math.random() * (metric.max - metric.min)
        }
        const passed = Math.random() > 0.2 // bias toward pass for the demo
        setStates((prev) => ({
          ...prev,
          [key]: {
            status: passed ? "passed" : "failed",
            progress: 100,
            results,
          },
        }))
      } else {
        const p = progress
        setStates((prev) => {
          const cur = prev[key]
          if (!cur || cur.status !== "running") return prev
          return { ...prev, [key]: { ...cur, progress: p } }
        })
      }
    }, 120)

    timersRef.current[key] = timer
  }

  function runAll() {
    for (const mod of visibleModules) runModule(mod.key)
  }

  const anyRunning = visibleModules.some(
    (m) => states[m.key]?.status === "running"
  )
  const passedCount = visibleModules.filter(
    (m) => states[m.key]?.status === "passed"
  ).length
  const failedCount = visibleModules.filter(
    (m) => states[m.key]?.status === "failed"
  ).length

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold tracking-tight">
            Hardware Benchmark
          </h2>
          <p className="text-xs text-muted-foreground">
            Simulated benchmark — results are mock data and do not run on the
            device yet.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {passedCount > 0 || failedCount > 0 ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {passedCount} passed · {failedCount} failed
            </span>
          ) : null}
          <Button size="sm" onClick={runAll} disabled={anyRunning}>
            {anyRunning ? "Running…" : "Run all"}
          </Button>
        </div>
      </div>

      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {visibleModules.map((mod) => {
          const st = states[mod.key] ?? IDLE
          return (
            <Card key={mod.key} size="sm" className="flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <CardTitle className="text-sm">{mod.label}</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {mod.description}
                    </p>
                  </div>
                  {statusBadge(st.status)}
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-150 ease-linear"
                    style={{ width: `${st.progress}%` }}
                  />
                </div>
                <div className="flex flex-col">
                  {mod.metrics.map((metric, i) => (
                    <Fragment key={metric.key}>
                      {i > 0 ? <Separator /> : null}
                      <div className="flex items-center justify-between py-1.5 text-sm">
                        <span className="text-muted-foreground">
                          {metric.label}
                        </span>
                        <span className="font-medium tabular-nums">
                          {st.results
                            ? formatValue(
                                st.results[metric.key],
                                metric.decimals
                              )
                            : "—"}
                          {metric.unit ? (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              {metric.unit}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    </Fragment>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-auto"
                  onClick={() => runModule(mod.key)}
                  disabled={st.status === "running"}
                >
                  {st.status === "running"
                    ? "Running…"
                    : st.status === "idle"
                      ? "Run"
                      : "Re-run"}
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
