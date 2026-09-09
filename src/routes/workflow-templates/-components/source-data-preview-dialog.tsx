import { useEffect, useState } from "react"
import { Loader2Icon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { JsonTree } from "@/components/json-tree"
import { xg, xgMessage } from "@/lib/xorgate"
import { parseCsv } from "@/lib/csv-parse"
import {
  bindingLabel,
  formatBytes,
  type TelemetryBinding,
} from "./simulator-types"

// Previews the data behind a bound sensor source before the run: an uploaded
// CSV is read in the browser (nothing is uploaded), a device window is fetched
// from the telemetry API the same way the simulator will resolve it. Either
// way the rows show as a table and as JSON.

const CSV_MAX_BYTES = 5 * 1024 * 1024
const TABLE_ROW_CAP = 200

interface Dataset {
  columns: string[]
  rows: Array<Record<string, string | number | null>>
  note: string
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; data: Dataset }
  | { kind: "error"; message: string }

async function loadCsv(file: File): Promise<Dataset> {
  if (file.size > CSV_MAX_BYTES) {
    throw new Error(
      `${formatBytes(file.size)} is larger than the ${formatBytes(CSV_MAX_BYTES)} in-browser preview cap; the run still reads the whole file`
    )
  }
  const { columns, rows } = parseCsv(await file.text())
  return {
    columns,
    rows: rows.map((r) =>
      Object.fromEntries(columns.map((c, i) => [c, r[i] ?? ""]))
    ),
    note: `${rows.length} row${rows.length === 1 ? "" : "s"} · ${columns.length} column${columns.length === 1 ? "" : "s"} · read locally, not uploaded`,
  }
}

// Readings arrive one (ts, metric) per row; pivot to one row per timestamp
// with a column per metric, the shape the CSV form uses too.
async function loadDevice(
  binding: Extract<TelemetryBinding, { kind: "device-telemetry" }>
): Promise<Dataset> {
  const w = binding.window ?? { mode: "lastN" as const, n: 100 }
  const history =
    w.mode === "range"
      ? await xg().telemetry.history(binding.deviceId, {
          from: w.from,
          to: w.to,
        })
      : await xg().telemetry.recent(binding.deviceId, { limit: w.n })
  const byTs = new Map<string, Record<string, string | number | null>>()
  const metrics = new Set<string>()
  for (const r of history.readings) {
    metrics.add(r.metric)
    let row = byTs.get(r.ts)
    if (!row) {
      row = { ts: r.ts }
      byTs.set(r.ts, row)
    }
    row[r.metric] = r.value
  }
  const rows = [...byTs.values()].sort((a, b) =>
    String(a.ts).localeCompare(String(b.ts))
  )
  const columns = ["ts", ...[...metrics].sort()]
  const scope =
    w.mode === "range"
      ? `${w.from} to ${w.to}`
      : `last ${w.n} reading${w.n === 1 ? "" : "s"}`
  return {
    columns,
    rows,
    note: `${rows.length} timestamp${rows.length === 1 ? "" : "s"} · ${metrics.size} metric${metrics.size === 1 ? "" : "s"} · ${scope}${history.truncated ? " · truncated by the API row cap" : ""}`,
  }
}

function DataTable({ data }: { data: Dataset }) {
  const shown = data.rows.slice(0, TABLE_ROW_CAP)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        <Table className="font-mono text-[11px]">
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              <TableHead className="w-10 text-muted-foreground">#</TableHead>
              {data.columns.map((c) => (
                <TableHead key={c} className="whitespace-nowrap">
                  {c}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row, i) => (
              <TableRow key={i}>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                {data.columns.map((c) => (
                  <TableCell key={c} className="whitespace-nowrap">
                    {row[c] === null || row[c] === undefined ? (
                      <span className="text-muted-foreground">null</span>
                    ) : (
                      String(row[c])
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {data.rows.length > shown.length ? (
        <p className="text-[11px] text-muted-foreground">
          Showing the first {shown.length} of {data.rows.length} rows; the JSON
          view has all of them.
        </p>
      ) : null}
    </div>
  )
}

export function SourceDataPreviewDialog({
  binding,
  open,
  onOpenChange,
}: {
  binding: TelemetryBinding | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [loaded, setLoaded] = useState<{
    binding: TelemetryBinding
    state: State
  } | null>(null)
  const state: State =
    binding && loaded?.binding === binding ? loaded.state : { kind: "loading" }

  useEffect(() => {
    if (!open || !binding) return
    let cancelled = false
    const set = (s: State) => {
      if (!cancelled) setLoaded({ binding, state: s })
    }
    ;(binding.kind === "csv-file"
      ? loadCsv(binding.file)
      : loadDevice(binding)
    ).then(
      (data) => set({ kind: "ready", data }),
      (err) => set({ kind: "error", message: xgMessage(err) })
    )
    return () => {
      cancelled = true
    }
  }, [open, binding])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] flex-col gap-2 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate">
            {binding ? bindingLabel(binding) : "Preview"}
          </DialogTitle>
          <DialogDescription>
            {state.kind === "ready"
              ? state.data.note
              : binding?.kind === "csv-file"
                ? "The uploaded CSV, read locally."
                : "The device's telemetry window the run will read."}
          </DialogDescription>
        </DialogHeader>
        {state.kind === "loading" ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2Icon className="size-5 animate-spin" />
          </div>
        ) : state.kind === "error" ? (
          <p className="rounded-md border border-dashed border-destructive/50 px-3 py-6 text-center text-xs text-destructive">
            {state.message}
          </p>
        ) : (
          <Tabs
            defaultValue="table"
            className="flex min-h-0 flex-1 flex-col gap-2"
          >
            <TabsList variant="line" className="w-full justify-start">
              <TabsTrigger value="table">Table</TabsTrigger>
              <TabsTrigger value="json">JSON</TabsTrigger>
            </TabsList>
            <TabsContent value="table" className="flex min-h-0 flex-1 flex-col">
              <DataTable data={state.data} />
            </TabsContent>
            <TabsContent
              value="json"
              className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/30 p-2"
            >
              <JsonTree value={state.data.rows} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
