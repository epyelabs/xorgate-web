import { CheckIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { type Recording } from "@/lib/api"
import { formatRelative } from "@/lib/relative-time"
import { cn } from "@/lib/utils"
import type { ManualWindow } from "@/lib/device-workflow-schemas"
import { Segmented } from "@/routes/devices/-components/trigger-editors"

// Shared "pick a recording / choose a telemetry window" widgets. Extracted from
// the device Run-now dialog so the workflow-template simulator pane can reuse the
// exact same selectors without duplicating their loading / empty / disabled logic.

function formatDur(ms: number | null): string {
  if (ms === null || ms <= 0) return "—"
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function recordingDurationMs(rec: Recording): number | null {
  if (rec.durationMs !== null) return rec.durationMs
  if (rec.endedAt)
    return new Date(rec.endedAt).getTime() - new Date(rec.startedAt).getTime()
  return null
}

export function WindowPicker({
  value,
  onChange,
  unit,
}: {
  value: ManualWindow
  onChange: (value: ManualWindow) => void
  unit: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">Context window</span>
        <Segmented
          value={value.mode}
          onChange={(mode) =>
            onChange(
              mode === "range"
                ? { mode: "range", from: "", to: "" }
                : { mode: "lastN", n: 100 },
            )
          }
          options={[
            { value: "range", label: "Range" },
            { value: "lastN", label: "Last N" },
          ]}
        />
      </div>
      {value.mode === "range" ? (
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="datetime-local"
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
          <Input
            type="datetime-local"
            value={value.to}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            className="w-24"
            value={String(value.n)}
            onChange={(e) =>
              onChange({
                mode: "lastN",
                n: Math.max(1, Math.trunc(Number(e.target.value) || 0)),
              })
            }
          />
          <span className="text-xs text-muted-foreground">
            most recent {unit}
          </span>
        </div>
      )}
    </div>
  )
}

// Recording list with loading / error / empty states. `single` renders radios
// (pick one) vs checkboxes (pick many). Only completed recordings are selectable.
export function RecordingsList({
  recordings,
  recError,
  selectedIds,
  single,
  onToggle,
}: {
  recordings: Recording[] | null
  recError: string | null
  selectedIds: string[]
  single: boolean
  onToggle: (id: string) => void
}) {
  if (recError) {
    return (
      <p className="rounded-md border border-dashed border-destructive/50 px-3 py-4 text-center text-xs text-destructive">
        Couldn&apos;t load recordings: {recError}
      </p>
    )
  }
  if (recordings === null) {
    return (
      <div className="flex flex-col gap-1">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }
  if (recordings.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
        No recordings on this device yet. Record something first, then run this
        workflow.
      </p>
    )
  }
  return (
    <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-md border border-border p-1">
      {recordings.map((rec) => {
        const selectable = rec.status === "completed"
        const on = selectedIds.includes(rec.id)
        return (
          <button
            key={rec.id}
            type="button"
            role={single ? "radio" : "checkbox"}
            aria-checked={on}
            disabled={!selectable}
            onClick={() => onToggle(rec.id)}
            className={cn(
              "flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors",
              selectable ? "hover:bg-muted/50" : "cursor-not-allowed opacity-60",
            )}
          >
            {single ? (
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                  on ? "border-primary" : "border-muted-foreground/40",
                )}
              >
                {on ? <span className="size-2 rounded-full bg-primary" /> : null}
              </span>
            ) : (
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/40",
                )}
              >
                {on ? <CheckIcon className="size-3" /> : null}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-xs text-foreground">
                {rec.streamKey}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {formatRelative(rec.startedAt)} ago ·{" "}
                {formatDur(recordingDurationMs(rec))}
              </span>
            </span>
            {!selectable ? <Badge variant="outline">{rec.status}</Badge> : null}
          </button>
        )
      })}
    </div>
  )
}
