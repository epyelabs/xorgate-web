import {
  CheckIcon,
  ClockIcon,
  GaugeIcon,
  HardDriveDownloadIcon,
  PlusIcon,
  Trash2Icon,
  VideoIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { metricLabel } from "@/lib/telemetry-meta"
import {
  TRIGGER_TYPE_LABELS,
  type AttachmentTrigger,
  type AttachmentTriggerType,
  type ConditionOperator,
  type ContextWindow,
} from "@/lib/device-workflow-schemas"

// Narrow each discriminated-union member so the field editors stay type-safe.
type SessionTrigger = Extract<AttachmentTrigger, { type: "session_completed" }>
type SegmentTrigger = Extract<AttachmentTrigger, { type: "segment_uploaded" }>
type ScheduleTrigger = Extract<AttachmentTrigger, { type: "schedule" }>
type ConditionTrigger = Extract<
  AttachmentTrigger,
  { type: "telemetry_condition" }
>

const TRIGGER_ICON: Record<AttachmentTriggerType, LucideIcon> = {
  session_completed: HardDriveDownloadIcon,
  segment_uploaded: VideoIcon,
  schedule: ClockIcon,
  telemetry_condition: GaugeIcon,
}

const OPERATOR_OPTIONS: { value: ConditionOperator; label: string }[] = [
  { value: "gt", label: "> greater than" },
  { value: "gte", label: "≥ at least" },
  { value: "lt", label: "< less than" },
  { value: "lte", label: "≤ at most" },
  { value: "eq", label: "= equals" },
  { value: "neq", label: "≠ not equal" },
]

const TRIGGER_ORDER: AttachmentTriggerType[] = [
  "session_completed",
  "segment_uploaded",
  "schedule",
  "telemetry_condition",
]

// A fresh trigger of the chosen type, with sensible defaults. `metricOptions`
// seeds the first telemetry condition's metric from the device's real catalog.
function makeDefaultTrigger(
  type: AttachmentTriggerType,
  metricOptions: string[],
): AttachmentTrigger {
  switch (type) {
    case "session_completed":
    case "segment_uploaded":
      return { type, streamKeys: [] }
    case "schedule":
      return {
        type,
        cron: "0 * * * *",
        telemetryContext: { mode: "sinceLastRun" },
        mediaContext: { mode: "sinceLastRun" },
      }
    case "telemetry_condition":
      return {
        type,
        combinator: "and",
        conditions: [{ metric: metricOptions[0] ?? "", operator: "gt", value: 0 }],
      }
  }
}

// Small segmented button group, reused for GUI/JSON, context mode, and AND/OR.
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string; icon?: LucideIcon }[]
  className?: string
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border border-border p-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const Icon = opt.icon
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
              value === opt.value
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon ? <Icon className="size-3.5" /> : null}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// Shared by session_completed and segment_uploaded — both are just a
// stream-key subset picker.
function StreamKeyFields<T extends SessionTrigger | SegmentTrigger>({
  value,
  onChange,
  streamKeys,
}: {
  value: T
  onChange: (value: T) => void
  streamKeys: string[]
}) {
  const toggle = (key: string) => {
    const on = value.streamKeys.includes(key)
    onChange({
      ...value,
      streamKeys: on
        ? value.streamKeys.filter((k) => k !== key)
        : [...value.streamKeys, key],
    })
  }
  const allSelected =
    streamKeys.length > 0 && streamKeys.every((k) => value.streamKeys.includes(k))
  const toggleAll = () =>
    onChange({
      ...value,
      streamKeys: allSelected ? [] : [...streamKeys],
    })

  if (streamKeys.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
        This device has no provisioned video streams. Provision the device to
        record and run video workflows.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">
          Streams
          <span className="ml-1.5 font-normal text-muted-foreground">
            (select one or more)
          </span>
        </span>
        <button
          type="button"
          onClick={toggleAll}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {allSelected ? "Clear all" : "Select all"}
        </button>
      </div>
      <div className="flex flex-col gap-0.5 rounded-md border border-border p-1">
        {streamKeys.map((key) => {
          const on = value.streamKeys.includes(key)
          return (
            <button
              key={key}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(key)}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
            >
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
              <span className="text-xs text-foreground">{key}</span>
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {value.type === "session_completed"
          ? "Runs once an on-device recording session finishes uploading, over the whole session (may run again if late segments arrive)."
          : "Runs as each ~60s chunk arrives, over that chunk only — near-realtime, one run per chunk per stream."}
      </p>
    </div>
  )
}

// A default window for each mode, used when the user switches context modes.
function contextForMode(mode: ContextWindow["mode"]): ContextWindow {
  switch (mode) {
    case "range":
      return { mode: "range", from: "", to: "" }
    case "lastN":
      return { mode: "lastN", n: 100 }
    case "sinceLastRun":
      return { mode: "sinceLastRun" }
  }
}

function ContextBlock({
  label,
  unit,
  value,
  onChange,
}: {
  label: string
  unit: string
  value: ContextWindow
  onChange: (value: ContextWindow) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        <Segmented
          value={value.mode}
          onChange={(mode) => onChange(contextForMode(mode))}
          options={[
            { value: "sinceLastRun", label: "Since last run" },
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
      ) : value.mode === "lastN" ? (
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
      ) : (
        <p className="text-xs text-muted-foreground">
          Captures all {unit} recorded since the previous scheduled run.
        </p>
      )}
    </div>
  )
}

function ScheduleFields({
  value,
  onChange,
}: {
  value: ScheduleTrigger
  onChange: (value: ScheduleTrigger) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Schedule (cron)</span>
        <Input
          value={value.cron}
          onChange={(e) => onChange({ ...value, cron: e.target.value })}
          placeholder="0 * * * *"
        />
        <p className="text-xs text-muted-foreground">
          Standard cron expression. Default runs hourly.
        </p>
      </div>
      <div className="rounded-md border border-border/70 p-2.5">
        <ContextBlock
          label="Telemetry context"
          unit="readings"
          value={value.telemetryContext}
          onChange={(c) => onChange({ ...value, telemetryContext: c })}
        />
      </div>
      <div className="rounded-md border border-border/70 p-2.5">
        <ContextBlock
          label="Media context"
          unit="sessions"
          value={value.mediaContext}
          onChange={(c) => onChange({ ...value, mediaContext: c })}
        />
      </div>
    </div>
  )
}

function ConditionFields({
  value,
  onChange,
  metricOptions,
}: {
  value: ConditionTrigger
  onChange: (value: ConditionTrigger) => void
  metricOptions: string[]
}) {
  const setCond = (i: number, next: ConditionTrigger["conditions"][number]) =>
    onChange({
      ...value,
      conditions: value.conditions.map((c, idx) => (idx === i ? next : c)),
    })
  const addCond = () =>
    onChange({
      ...value,
      conditions: [
        ...value.conditions,
        { metric: metricOptions[0] ?? "", operator: "gt", value: 0 },
      ],
    })
  const removeCond = (i: number) =>
    onChange({
      ...value,
      conditions: value.conditions.filter((_, idx) => idx !== i),
    })

  if (metricOptions.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
        This device model reports no telemetry metrics, so there is nothing to
        condition on.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {value.conditions.length > 1 ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Match</span>
          <Segmented
            value={value.combinator}
            onChange={(combinator) => onChange({ ...value, combinator })}
            options={[
              { value: "and", label: "ALL (AND)" },
              { value: "or", label: "ANY (OR)" },
            ]}
          />
        </div>
      ) : null}
      {value.conditions.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <Select
            value={c.metric}
            onValueChange={(metric) => setCond(i, { ...c, metric })}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Metric" />
            </SelectTrigger>
            <SelectContent>
              {metricOptions.map((m) => (
                <SelectItem key={m} value={m}>
                  {metricLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={c.operator}
            onValueChange={(operator) =>
              setCond(i, { ...c, operator: operator as ConditionOperator })
            }
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPERATOR_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            className="w-24"
            value={String(c.value)}
            onChange={(e) =>
              setCond(i, { ...c, value: Number(e.target.value) || 0 })
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => removeCond(i)}
            disabled={value.conditions.length === 1}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={addCond}
      >
        <PlusIcon />
        Add condition
      </Button>
    </div>
  )
}

// The repeatable list of trigger cards plus the "Add trigger" type menu.
// `streamKeys` / `metricOptions` come from the device's real provisioned channels
// and model capabilities (see attach-workflow-sheet.tsx).
export function TriggersEditor({
  triggers,
  onChange,
  streamKeys,
  metricOptions,
}: {
  triggers: AttachmentTrigger[]
  onChange: (triggers: AttachmentTrigger[]) => void
  streamKeys: string[]
  metricOptions: string[]
}) {
  const update = (i: number, next: AttachmentTrigger) =>
    onChange(triggers.map((t, idx) => (idx === i ? next : t)))
  const remove = (i: number) =>
    onChange(triggers.filter((_, idx) => idx !== i))
  const add = (type: AttachmentTriggerType) =>
    onChange([...triggers, makeDefaultTrigger(type, metricOptions)])

  const addMenu = (alignClass: string) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={alignClass}>
          <PlusIcon />
          Add trigger
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {TRIGGER_ORDER.map((type) => {
          const Icon = TRIGGER_ICON[type]
          return (
            <DropdownMenuItem
              key={type}
              onSelect={() => add(type)}
              className="whitespace-nowrap"
            >
              <Icon />
              {TRIGGER_TYPE_LABELS[type]}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (triggers.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border px-3 py-6 text-center">
        <p className="text-xs text-muted-foreground">
          No triggers yet. Add at least one so the workflow knows when to run.
        </p>
        {addMenu("self-center")}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {triggers.map((t, i) => {
        const Icon = TRIGGER_ICON[t.type]
        return (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg border border-border p-3"
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                <Icon className="size-3.5 text-muted-foreground" />
                {TRIGGER_TYPE_LABELS[t.type]}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => remove(i)}
              >
                <Trash2Icon />
              </Button>
            </div>
            {t.type === "session_completed" || t.type === "segment_uploaded" ? (
              <StreamKeyFields
                value={t}
                onChange={(n) => update(i, n)}
                streamKeys={streamKeys}
              />
            ) : null}
            {t.type === "schedule" ? (
              <ScheduleFields value={t} onChange={(n) => update(i, n)} />
            ) : null}
            {t.type === "telemetry_condition" ? (
              <ConditionFields
                value={t}
                onChange={(n) => update(i, n)}
                metricOptions={metricOptions}
              />
            ) : null}
          </div>
        )
      })}
      {addMenu("self-start")}
    </div>
  )
}
