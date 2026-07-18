import { useMemo } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  type FunctionConfig,
  mockFunctionMetrics,
} from "@/lib/code-function-runtime"

// Lambda-style monitoring, on deterministic mock data (seeded per node id) so
// the tab reads the same across reopens with no backend. Real data source
// later: workflow_run_steps rows for this node id.
//
// Chart colors: one blue for the single-series invocation counts, two steps of
// the same blue for the ordered p50/p95 pair (legend shown — two series), and
// the reserved status red for errors only. Values/labels stay in text tokens.
const PALETTE = {
  light: { series: "#2a78d6", seriesSoft: "#86b6ef", critical: "#d03b3b" },
  dark: { series: "#3987e5", seriesSoft: "#5598e7", critical: "#d03b3b" },
}

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="font-heading text-lg font-medium">{value}</p>
      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

const AXIS_TICK = { fontSize: 10 }
const TOOLTIP_STYLE = { fontSize: 11 }

export function MonitorTab({ nodeId, fn }: { nodeId: string; fn: FunctionConfig }) {
  const metrics = useMemo(() => mockFunctionMetrics(nodeId), [nodeId])
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  const colors = isDark ? PALETTE.dark : PALETTE.light

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          Last 24 hours · sample data — live metrics arrive with the backend runtime
        </p>
        <Badge variant="outline">
          {fn.deployedVersion !== null ? `v${fn.deployedVersion}` : "$LATEST"}
        </Badge>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile label="Invocations" value={metrics.totalInvocations.toLocaleString()} />
        <StatTile label="Errors" value={metrics.totalErrors.toLocaleString()} />
        <StatTile label="Error rate" value={`${metrics.errorRatePct.toFixed(2)}%`} />
        <StatTile label="Duration p95" value={`${metrics.p95Ms} ms`} hint="worst hour" />
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Invocations / hour</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={metrics.buckets} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis dataKey="hour" tick={AXIS_TICK} minTickGap={32} />
                <YAxis tick={AXIS_TICK} width={40} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "transparent" }} />
                <Bar
                  dataKey="invocations"
                  name="Invocations"
                  fill={colors.series}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Duration (ms)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={metrics.buckets} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis dataKey="hour" tick={AXIS_TICK} minTickGap={32} />
                <YAxis tick={AXIS_TICK} width={40} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="p50"
                  name="p50"
                  stroke={colors.seriesSoft}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="p95"
                  name="p95"
                  stroke={colors.series}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Errors / hour</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={metrics.buckets} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                <XAxis dataKey="hour" tick={AXIS_TICK} minTickGap={32} />
                <YAxis tick={AXIS_TICK} width={40} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "transparent" }} />
                <Bar
                  dataKey="errors"
                  name="Errors"
                  fill={colors.critical}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="shrink-0 rounded-md border border-border">
        <p className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-medium">
          Recent invocations
        </p>
        <ul className="divide-y divide-border">
          {metrics.recent.map((inv) => (
            <li key={inv.id} className="flex items-center gap-3 px-3 py-1.5 text-[11px]">
              {inv.status === "ok" ? (
                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  OK
                </Badge>
              ) : (
                <Badge variant="destructive">Error</Badge>
              )}
              <span className="font-mono text-muted-foreground">{inv.id}</span>
              <span className="ml-auto tabular-nums">{inv.durationMs} ms</span>
              <span className="w-20 text-right text-muted-foreground tabular-nums">
                {timeFmt.format(new Date(inv.at))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
