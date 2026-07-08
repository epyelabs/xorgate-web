import { useState } from "react"
import { CalendarIcon } from "lucide-react"
import { type DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

// A reusable time-range filter: a "Date" popover with a two-month range calendar
// plus preset chips (All / 1h / 6h / 24h / 7d). Presets and custom ranges are
// emitted as ISO `from`/`to` bounds so any list endpoint can consume them
// (extracted from the Telemetry History toolbar).
export type DateRangeMode = "all" | "1h" | "6h" | "24h" | "7d" | "custom"

export interface DateRangeValue {
  mode: DateRangeMode
  from?: string
  to?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

const PRESETS: { label: string; mode: DateRangeMode; ms: number }[] = [
  { label: "1h", mode: "1h", ms: 60 * 60 * 1000 },
  { label: "6h", mode: "6h", ms: 6 * 60 * 60 * 1000 },
  { label: "24h", mode: "24h", ms: DAY_MS },
  { label: "7d", mode: "7d", ms: 7 * DAY_MS },
]

const shortDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
})

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

// Custom windows are stored as [startOfDay(from), startOfDay(to)+1day) so the
// picked end date is inclusive. Reconstruct the inclusive dates for display.
function rangeLabel(fromIso: string, toIso: string): string {
  const from = new Date(fromIso)
  const toIncl = new Date(Date.parse(toIso) - 1)
  const f = shortDate.format(from)
  const t = shortDate.format(toIncl)
  return f === t ? f : `${f} – ${t}`
}

export function DateRangeFilter({
  value,
  onChange,
}: {
  value: DateRangeValue
  onChange: (next: DateRangeValue) => void
}) {
  const [customOpen, setCustomOpen] = useState(false)
  const [pendingRange, setPendingRange] = useState<DateRange | undefined>(
    undefined
  )

  const applyPreset = (mode: DateRangeMode, ms: number) => {
    const now = Date.now()
    onChange({
      mode,
      from: new Date(now - ms).toISOString(),
      to: new Date(now).toISOString(),
    })
  }

  const applyAll = () => onChange({ mode: "all", from: undefined, to: undefined })

  const openCustom = (open: boolean) => {
    if (open) {
      setPendingRange(
        value.from && value.to
          ? {
              from: new Date(value.from),
              to: new Date(Date.parse(value.to) - 1),
            }
          : undefined
      )
    }
    setCustomOpen(open)
  }

  const selectRange = (r: DateRange | undefined) => {
    setPendingRange(r)
    if (r?.from && r?.to) {
      const from = startOfDay(r.from)
      const toExcl = new Date(startOfDay(r.to).getTime() + DAY_MS)
      onChange({
        mode: "custom",
        from: from.toISOString(),
        to: toExcl.toISOString(),
      })
      setCustomOpen(false)
    }
  }

  const customActive = value.mode === "custom"
  const customLabel =
    customActive && value.from && value.to
      ? rangeLabel(value.from, value.to)
      : "Date"

  const chips: { key: DateRangeMode; label: string; onClick: () => void }[] = [
    { key: "all", label: "All", onClick: applyAll },
    ...PRESETS.map((p) => ({
      key: p.mode,
      label: p.label,
      onClick: () => applyPreset(p.mode, p.ms),
    })),
  ]

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover open={customOpen} onOpenChange={openCustom}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={customActive ? "default" : "outline"}
            size="sm"
            className="h-7 gap-1.5 px-2.5"
          >
            <CalendarIcon className="size-3.5" />
            {customLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            numberOfMonths={2}
            defaultMonth={pendingRange?.from}
            selected={pendingRange}
            onSelect={selectRange}
            autoFocus
          />
        </PopoverContent>
      </Popover>

      <div className="flex flex-wrap items-center gap-1">
        {chips.map((c) => (
          <Button
            key={c.key}
            type="button"
            variant={value.mode === c.key ? "default" : "outline"}
            size="sm"
            className="h-7 px-2.5"
            onClick={c.onClick}
          >
            {c.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
