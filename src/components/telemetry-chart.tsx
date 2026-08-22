import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { HistoryPoint } from "@/lib/telemetry-meta"
import { metricLabel } from "@/lib/telemetry-meta"

const COLORS = ["#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c"]

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

export function TelemetryChart({
  title,
  history,
  metrics,
}: {
  title: string
  history: HistoryPoint[]
  metrics: string[]
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={history} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="ts"
              tickFormatter={(t) => timeFmt.format(Number(t))}
              tick={{ fontSize: 11 }}
              minTickGap={48}
            />
            <YAxis tick={{ fontSize: 11 }} width={44} />
            <Tooltip
              labelFormatter={(label) => timeFmt.format(Number(label))}
              contentStyle={{ fontSize: 12 }}
            />
            {metrics.map((m, i) => (
              <Line
                key={m}
                type="monotone"
                dataKey={m}
                name={metricLabel(m)}
                stroke={COLORS[i % COLORS.length]}
                dot={false}
                isAnimationActive={false}
                strokeWidth={2}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
