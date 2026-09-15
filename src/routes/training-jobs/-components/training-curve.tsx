import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

// mAP50 and loss per epoch, read off the progress tail. The tail is a window
// over the log, so a long run shows its last epochs; that is the part a
// watcher cares about while it runs, and the part that decides early stop.
export interface CurvePoint {
  epoch: number
  mAP50: number | null
  loss: number | null
}

export function TrainingCurve({ points }: { points: CurvePoint[] }) {
  const hasMap = points.some((p) => p.mAP50 !== null)
  const hasLoss = points.some((p) => p.loss !== null)
  return (
    <div className="flex flex-col gap-2" data-testid="training-curve">
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="epoch" tick={{ fontSize: 11 }} minTickGap={24} />
          {hasMap ? <YAxis yAxisId="map" domain={[0, 1]} tick={{ fontSize: 11 }} width={40} /> : null}
          {hasLoss ? <YAxis yAxisId="loss" orientation="right" tick={{ fontSize: 11 }} width={44} /> : null}
          <Tooltip
            contentStyle={{ fontSize: 12 }}
            labelFormatter={(label) => `Epoch ${String(label)}`}
            formatter={(value, name) => [typeof value === "number" ? value.toFixed(4) : String(value ?? "—"), String(name ?? "")]}
          />
          {hasMap ? (
            <Line yAxisId="map" type="monotone" dataKey="mAP50" name="mAP50" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          ) : null}
          {hasLoss ? (
            <Line yAxisId="loss" type="monotone" dataKey="loss" name="loss" stroke="#0ea5e9" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        {hasMap ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded bg-emerald-500" /> mAP50 (left axis)
          </span>
        ) : null}
        {hasLoss ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded bg-sky-500" /> loss (right axis)
          </span>
        ) : null}
      </div>
    </div>
  )
}
