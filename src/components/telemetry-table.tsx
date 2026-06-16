import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { HistoryPoint } from "@/hooks/use-iot-telemetry"
import { formatMetricValue, metricLabel } from "@/lib/telemetry-meta"

const timeFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

export function TelemetryTable({
  history,
  metrics,
  units,
}: {
  history: HistoryPoint[]
  metrics: string[]
  units: Record<string, string>
}) {
  // Hook sorts ascending; show most recent buckets first.
  const rows = [...history].reverse()

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Readings</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[10px] tracking-[0.14em] uppercase text-muted-foreground">
                Time
              </TableHead>
              {metrics.map((m) => (
                <TableHead
                  key={m}
                  className="text-right text-[10px] tracking-[0.14em] uppercase text-muted-foreground"
                >
                  {metricLabel(m)}
                  {units[m] ? ` (${units[m]})` : ""}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((point) => (
              <TableRow key={point.ts}>
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {timeFmt.format(point.ts)}
                </TableCell>
                {metrics.map((m) => {
                  const value = point[m]
                  return (
                    <TableCell
                      key={m}
                      className="text-right text-xs tabular-nums"
                    >
                      {typeof value === "number"
                        ? formatMetricValue(value, m)
                        : "—"}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
