import { useMemo, useState } from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"
import { ChartSplineIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDuration } from "@/components/data-table"
import { formatDateTime } from "@/lib/format-time"
import {
  axisDomain,
  CHART_METRIC_NAMES,
  METRIC_SECTIONS,
  seriesColor,
  seriesSlot,
  TELEMETRY_GRAPH_GROUPS,
  type ChartMetric,
  type ChartMetricGroup,
  type MetricSection,
} from "@/lib/telemetry-metrics"
import { cn } from "@/lib/utils"
import { xgMessage } from "@/lib/xorgate"
import {
  useSessionTelemetry,
  type TelemetrySample,
} from "@/hooks/use-session-telemetry"

/** The tabs: one per section, in the order the readouts introduce them. */
const TABS = METRIC_SECTIONS

/** A metric name is not a CSS identifier — `gps.speed` would end the token. */
const seriesKey = (metric: string) => metric.replace(/\W/g, "_")

/** Time of day for the shared x-axis; the tooltip carries the full stamp. */
function clockTick(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * The rows a panel actually draws.
 *
 * Buckets are sized for GPS, which reports about once a second. The LTE group
 * reports every 15-20 s and the system group every 10, so for those metrics
 * MOST buckets hold nothing. Handing Recharts one row per bucket with nulls in
 * between means no two of their points are ever adjacent — and a line with no
 * adjacent points and no dots draws NOTHING, which is why the Connectivity
 * panels came up blank. So a panel is given only the buckets its own metrics
 * reported in, and its points join up.
 *
 * A real outage still has to break the line rather than be drawn straight
 * through, so a hole several times wider than the metric's own cadence gets an
 * explicit null row: `connectNulls` is off, and that is where the line stops.
 */
function panelSeries(
  samples: TelemetrySample[],
  metrics: ChartMetric[]
): TelemetrySample[] {
  const has = (row: TelemetrySample, metric: string) =>
    row[metric] !== null && row[metric] !== undefined
  const rows = samples.filter((row) => metrics.some((m) => has(row, m.metric)))
  // Two points cannot establish a cadence, and cannot hide a gap either.
  if (rows.length < 3) return rows

  // Median rather than mean: one long outage would drag a mean far enough to
  // stop any gap from ever counting as one.
  const deltas = rows
    .slice(1)
    .map((row, i) => row.t - rows[i].t)
    .sort((a, b) => a - b)
  const cadence = deltas[Math.floor(deltas.length / 2)]
  const breakAfter = Math.max(cadence * 4, 30_000)

  const hole = Object.fromEntries(
    metrics.map((m) => [m.metric, null])
  ) as Record<string, number | null>

  const out: TelemetrySample[] = []
  for (const [i, row] of rows.entries()) {
    const previous = rows[i - 1]
    if (previous && row.t - previous.t > breakAfter) {
      out.push({ ...hole, t: (previous.t + row.t) / 2 })
    }
    out.push(row)
  }
  return out
}

/** The summary columns, in the order they read. */
const STAT_KEYS = [
  ["Min", "min"],
  ["Max", "max"],
  ["Avg", "avg"],
] as const

/**
 * Min, max and mean of one series over the whole replay window.
 *
 * Computed from the same rows the line is drawn from, so the numbers and the
 * shape can never disagree — including the null rows `panelSeries` inserts at
 * an outage, which are skipped rather than counted as zero.
 *
 * These describe the BUCKET AVERAGES, not the raw readings: at a 7 s bucket a
 * one-second spike is averaged away before it ever reaches here, so the true
 * peak of a spiky metric was higher than the max shown. The header says so on
 * hover rather than quietly overstating what this is.
 */
function summarise(rows: TelemetrySample[], metric: string) {
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let n = 0
  for (const row of rows) {
    const value = row[metric]
    if (typeof value !== "number" || !Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
    sum += value
    n += 1
  }
  return n === 0 ? null : { min, max, avg: sum / n }
}

/**
 * One panel: every metric in it on ONE y-axis.
 *
 * `syncId` is what makes the grid of panels read as a single chart with many
 * lanes — hovering anywhere puts the crosshair at the same instant in all of
 * them, which is the whole reason to plot a replay this way. Clicking seeks
 * the player underneath, so a spike found here is one click from the footage
 * that explains it.
 */
function MetricPanel({
  group,
  visible,
  samples,
  window,
  bucketSeconds,
  playheadTs,
  onSeek,
}: {
  group: ChartMetricGroup
  /** The group's metrics the operator has left on, in the group's own order. */
  visible: ChartMetric[]
  samples: TelemetrySample[]
  window: { fromMs: number; toMs: number }
  /** Width the API averaged into, for the summary's honesty note. */
  bucketSeconds: number | null
  playheadTs: number | null
  onSeek?: (ts: number) => void
}) {
  // Colour follows the metric's place in the GROUP, not in the visible subset:
  // turning accel X off must not repaint Y from blue to orange.
  const config: ChartConfig = {}
  for (const metric of visible) {
    config[seriesKey(metric.metric)] = {
      label: metric.label,
      color: seriesColor(seriesSlot(group, metric)),
    }
  }

  const precisionOf = (key: string) =>
    visible.find((m) => seriesKey(m.metric) === key)?.precision ?? 1

  const data = panelSeries(samples, visible)
  const summaries = visible.map((metric) => ({
    metric,
    summary: summarise(data, metric.metric),
  }))
  // The widest extent any of this panel's visible lines reach, which is what
  // the axis has to hold.
  const bounds = summaries.reduce<{ min: number; max: number } | null>(
    (span, { summary }) =>
      !summary
        ? span
        : span
          ? {
              min: Math.min(span.min, summary.min),
              max: Math.max(span.max, summary.max),
            }
          : { min: summary.min, max: summary.max },
    null
  )
  const domain = axisDomain(group.domain, bounds)
  const bucketLabel = bucketSeconds ? `${bucketSeconds}s bucket` : "bucket"
  const statsNote = `Over the whole replay window, from the ${bucketLabel} averages this chart plots. A brief spike inside one ${bucketLabel} is averaged away, so a spiky metric really peaked higher than Max.`
  /** A metric with no readings in the window gets a dash, not a zero. */
  const format = (value: number | undefined, metric: ChartMetric) =>
    value === undefined ? "—" : value.toFixed(metric.precision)

  return (
    // A column, so the plot can take whatever height the grid row gives it:
    // tabs hold between one and seven panels, and a fixed plot height means
    // either a wall of white under Motion or a scrollbar under GPS.
    <section className="flex min-h-0 flex-col rounded-md border">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-3 py-2">
        <h3 className="text-xs font-medium">
          {group.title}
          {group.unit ? (
            <span className="ml-1 font-normal text-muted-foreground">
              {group.unit}
            </span>
          ) : null}
        </h3>
        {/* What each line did over the whole run — the question the readouts
            rail cannot answer, since that one shows the value under the
            playhead.

            One series takes a single line, because the panel title already
            names it. Several take a row of labelled swatches instead, which
            doubles as the panel's legend: that is what keeps identity off
            colour alone on the one multi-line panel in the catalog. */}
        {visible.length === 1 ? (
          <dl
            title={statsNote}
            className="flex items-baseline gap-3 text-xs tabular-nums"
          >
            {STAT_KEYS.map(([label, key]) => (
              <div key={label} className="flex items-baseline gap-1">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium">
                  {format(summaries[0].summary?.[key], summaries[0].metric)}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {visible.length > 1 ? (
          // One row, not a table: three labelled columns down the side left a
          // band of white across the whole panel to line up nine numbers. The
          // key sits at the front so the slashes need no legend of their own,
          // and each swatch still carries the line's identity.
          <div
            title={statsNote}
            className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs tabular-nums"
          >
            <span className="text-muted-foreground">Min / Max / Avg</span>
            {summaries.map(({ metric, summary }) => (
              <span
                key={metric.metric}
                className="flex items-center gap-1.5 whitespace-nowrap"
              >
                {/* `seriesColor` rather than the `--color-<key>` var the
                    chart's own marks use: that one is scoped to the
                    ChartContainer, and this sits outside it. */}
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor: seriesColor(seriesSlot(group, metric)),
                  }}
                />
                <span className="text-muted-foreground">{metric.label}</span>
                <span className="font-medium">
                  {STAT_KEYS.map(([, key]) =>
                    format(summary?.[key], metric)
                  ).join(" / ")}
                </span>
              </span>
            ))}
          </div>
        ) : null}
      </header>

      {data.length > 0 ? (
        <ChartContainer
          config={config}
          className="aspect-auto min-h-0 w-full flex-1 px-1 pt-2 pb-1"
        >
          <LineChart
            data={data}
            syncId="replay-telemetry"
            // Panels do not share a row set — each holds only the buckets its
            // own metrics reported in — so the crosshair has to line up on the
            // TIMESTAMP. Recharts syncs by array index by default, which across
            // ragged data would point every panel at a different moment.
            syncMethod="value"
            margin={{ top: 4, right: 10, bottom: 0, left: 0 }}
            onClick={(state) => {
              const at = Number(state?.activeLabel)
              if (onSeek && Number.isFinite(at)) onSeek(at)
            }}
            style={onSeek ? { cursor: "pointer" } : undefined}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            {/* The replay's own window rather than the data's extent, so every
                panel spans exactly the same instants — a metric that only
                reported for the last ten minutes lands under the right part of
                the one beside it instead of being stretched across. */}
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[window.fromMs, window.toMs]}
              tickFormatter={clockTick}
              tickLine={false}
              axisLine={false}
              minTickGap={36}
              tick={{ fontSize: 10 }}
            />
            <YAxis
              domain={domain}
              width={38}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10 }}
            />
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={
                <ChartTooltipContent
                  labelFormatter={(_label, payload) =>
                    formatDateTime(Number(payload?.[0]?.payload?.t))
                  }
                  // A bucket average carries the float the division produced;
                  // `47.842 km/h` claims a precision the GPS never had, so
                  // every row is cut back to the metric's own.
                  formatter={(value, name, item) => (
                    <>
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 self-center rounded-[2px]"
                        style={{ backgroundColor: item.color }}
                      />
                      <div className="flex flex-1 items-center justify-between gap-3 leading-none">
                        <span className="text-muted-foreground">
                          {config[String(name)]?.label ?? name}
                        </span>
                        <span className="font-mono font-medium text-foreground tabular-nums">
                          {typeof value === "number"
                            ? value.toFixed(precisionOf(String(name)))
                            : String(value)}
                        </span>
                      </div>
                    </>
                  )}
                />
              }
            />
            {playheadTs !== null ? (
              <ReferenceLine
                x={playheadTs}
                stroke="var(--color-foreground)"
                strokeWidth={1}
                strokeOpacity={0.45}
              />
            ) : null}
            {visible.map((metric) => (
              <Line
                key={metric.metric}
                dataKey={metric.metric}
                // Recharts looks the tooltip's config entry up by `name`; the
                // dataKey has to stay the raw metric to read the row.
                name={seriesKey(metric.metric)}
                type="monotone"
                stroke={`var(--color-${seriesKey(metric.metric)})`}
                strokeWidth={2}
                dot={false}
                activeDot={{
                  r: 4,
                  strokeWidth: 2,
                  stroke: "var(--color-background)",
                }}
                // A stretch the device said nothing about is a BREAK in the
                // line, not a straight segment across it.
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
      ) : (
        <p className="flex flex-1 items-center justify-center px-3 py-8 text-center text-xs text-muted-foreground">
          No readings in this replay.
        </p>
      )}
    </section>
  )
}

/** One metric's on/off chip, carrying its series colour when it is on. */
function MetricChip({
  metric,
  color,
  on,
  onToggle,
}: {
  metric: ChartMetric
  color: string
  on: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={cn(
        "flex h-6 items-center gap-1.5 rounded-sm border px-2 text-xs transition-colors",
        on
          ? "border-foreground/20 bg-accent text-foreground"
          : "border-border text-muted-foreground hover:bg-accent/50"
      )}
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-[2px]"
        style={{ backgroundColor: on ? color : "var(--color-border)" }}
      />
      {metric.label}
    </button>
  )
}

/**
 * A replay's telemetry as time series — the numbers the readouts show one
 * instant of, over the whole window.
 *
 * Deliberately a GRID of small charts rather than one chart with every metric
 * on it: km/h, metres, °C, dBm and volts do not share a scale, and stacking
 * them on one axis would make speed a flat line under altitude and hide the
 * 0.3 V sag that explains a reboot. Every panel is one unit, and a shared
 * crosshair is what ties them back together.
 */
export function TelemetryTrendsSheet({
  deviceId,
  window,
  metrics,
  playheadTs = null,
  onSeek,
}: {
  deviceId: string
  /**
   * The replay's own window in epoch ms, the player's currency — the graph
   * covers exactly what plays, no more.
   */
  window: { from: number; to: number }
  /** What the device model declares; the catalog is filtered down to these. */
  metrics: string[]
  playheadTs?: number | null
  onSeek?: (ts: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<MetricSection>(METRIC_SECTIONS[0])
  const [visible, setVisible] = useState<Set<string>>(
    () =>
      new Set(
        TELEMETRY_GRAPH_GROUPS.flatMap((g) => g.metrics)
          .filter((m) => m.defaultOn)
          .map((m) => m.metric)
      )
  )

  // Only metrics this device actually reports AND the catalog knows how to
  // scale. A model whose capabilities never loaded means the catalog stands
  // alone rather than the sheet showing nothing.
  const available = useMemo(() => {
    const declared = new Set(metrics)
    return metrics.length > 0
      ? CHART_METRIC_NAMES.filter((m) => declared.has(m))
      : CHART_METRIC_NAMES
  }, [metrics])

  const { from: fromMs, to: toMs } = window
  const range = useMemo(() => ({ from: fromMs, to: toMs }), [fromMs, toMs])

  // Everything at once, not just what is on screen: the whole point is that a
  // chip toggles instantly instead of putting a round trip behind it. The
  // catalog is larger than the endpoint's 20-metric cap, so the hook splits
  // the ask across calls.
  const telemetry = useSessionTelemetry(deviceId, range, available, {
    enabled: open,
  })

  const samples = telemetry.data?.samples ?? []

  /** The groups a tab owns, with each one's metrics the device reports. */
  const groupsIn = (id: MetricSection) =>
    TELEMETRY_GRAPH_GROUPS.filter((group) => group.section === id)
      .map((group) => ({
        group,
        offered: group.metrics.filter((m) => available.includes(m.metric)),
      }))
      // A model with no IMU offers nothing in the Acceleration panel; an empty
      // panel is not a panel.
      .filter(({ offered }) => offered.length > 0)

  const toggle = (metric: string) =>
    setVisible((previous) => {
      const next = new Set(previous)
      if (!next.delete(metric)) next.add(metric)
      return next
    })

  // Scoped to the tab in view: on "System", "Clear" turns off the system
  // metrics and leaves the GPS lines the operator lined them up against.
  const setAll = (id: MetricSection, on: boolean) =>
    setVisible((previous) => {
      const next = new Set(previous)
      for (const { offered } of groupsIn(id))
        for (const m of offered)
          if (on) next.add(m.metric)
          else next.delete(m.metric)
      return next
    })

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <ChartSplineIcon /> View Telemetry Trends
        </Button>
      </SheetTrigger>
      {/* 40% of the viewport, against the registry default of `sm:max-w-sm`
          (384px) which is sized for a form rather than for charts.

          The `!` is doing real work: the component sets its width under
          `data-[side=right]:sm:max-w-sm`, and a plain `sm:max-w-*` here loses
          to it on specificity — the attribute selector wins, and tailwind-merge
          cannot dedupe the two because the variant prefixes differ. Marking
          these important is what actually overrides it.

          `gap-0` plus the padding replaces the sheet's own spacing, since its
          content runs edge to edge. */}
      <SheetContent
        side="right"
        className="flex w-[40vw]! max-w-[40vw]! flex-col gap-0 p-4"
      >
        <SheetHeader className="shrink-0 p-0 pb-3">
          <SheetTitle>Telemetry trends</SheetTitle>
          <SheetDescription>
            {formatDateTime(fromMs)} — {formatDateTime(toMs)} ·{" "}
            {formatDuration(toMs - fromMs)}
            {telemetry.data?.bucketSeconds
              ? ` · averaged in ${telemetry.data.bucketSeconds}s buckets`
              : ""}
          </SheetDescription>
        </SheetHeader>

        {/* The row cap was hit, so what is drawn is real but INCOMPLETE — said
            here rather than left for the operator to infer from a line that
            simply stops. */}
        {telemetry.data?.truncated ? (
          <p className="mb-3 shrink-0 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            This window returned more readings than the API will send at once —
            the charts below are incomplete. Replay a shorter range to see all
            of it.
          </p>
        ) : null}

        <Tabs
          value={tab}
          onValueChange={(next) => setTab(next as MetricSection)}
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          {/* The rule is on a wrapper rather than the list itself, so it spans
              the sheet and the active tab's underline sits on it — the same
              treatment the device and account pages give their tabs. */}
          <div className="shrink-0 border-b">
            <TabsList variant="line">
              {TABS.map((id) => {
                // How many of this tab's metrics are drawn right now, so a tab
                // that is carrying something says so while you are on another.
                const on = groupsIn(id).reduce(
                  (total, { offered }) =>
                    total + offered.filter((m) => visible.has(m.metric)).length,
                  0
                )
                return (
                  <TabsTrigger key={id} value={id}>
                    {id}
                    {on > 0 ? (
                      <span className="ml-1.5 tabular-nums opacity-60">
                        {on}
                      </span>
                    ) : null}
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </div>

          {TABS.map((id) => {
            // Radix mounts only the open tab, so the charts of the other three
            // are not rendered at all — which is most of why this is tabs and
            // not a filter over one long grid.
            const inTab = groupsIn(id)
            const shown = inTab
              .map(({ group, offered }) => ({
                group,
                visible: offered.filter((m) => visible.has(m.metric)),
              }))
              .filter((g) => g.visible.length > 0)
            const anyOn = shown.length > 0

            return (
              <TabsContent
                key={id}
                value={id}
                className="flex min-h-0 flex-1 flex-col gap-3 outline-none"
              >
                {/* Filters in one row above the charts, exactly the metrics
                    this tab can draw. */}
                <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b pb-3">
                  {inTab.map(({ group, offered }) =>
                    offered.map((metric) => (
                      <MetricChip
                        key={metric.metric}
                        metric={metric}
                        color={seriesColor(seriesSlot(group, metric))}
                        on={visible.has(metric.metric)}
                        onToggle={() => toggle(metric.metric)}
                      />
                    ))
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setAll(id, true)}
                    >
                      Show all
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setAll(id, false)}
                      disabled={!anyOn}
                    >
                      Clear
                    </Button>
                  </div>
                </div>

                <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
                  {/* What the MODEL declares is known before any request, so a
                      tab this device cannot fill says so immediately rather
                      than spending a spinner to arrive at the same answer. */}
                  {inTab.length === 0 ? (
                    <p className="py-16 text-center text-xs text-muted-foreground">
                      This device model reports nothing in this group.
                    </p>
                  ) : telemetry.isPending ? (
                    <p className="py-16 text-center text-xs text-muted-foreground">
                      Loading telemetry…
                    </p>
                  ) : telemetry.error ? (
                    <p className="py-16 text-center text-xs text-muted-foreground">
                      Could not load telemetry: {xgMessage(telemetry.error)}
                    </p>
                  ) : !anyOn ? (
                    <p className="py-16 text-center text-xs text-muted-foreground">
                      Pick a metric above to plot it.
                    </p>
                  ) : samples.length === 0 ? (
                    <p className="py-16 text-center text-xs text-muted-foreground">
                      No telemetry was recorded in this window.
                    </p>
                  ) : (
                    // One column: a metric per chart, full width, read top to
                    // bottom. The rows share whatever height the tab has, down
                    // to a floor past which it scrolls instead — Motion is four
                    // panels and GPS is seven, and a fixed plot height cannot
                    // serve both.
                    <div className="grid h-full auto-rows-[minmax(11rem,1fr)] gap-3">
                      {shown.map(({ group, visible: lines }) => (
                        <MetricPanel
                          key={group.id}
                          group={group}
                          visible={lines}
                          samples={samples}
                          window={{ fromMs, toMs }}
                          bucketSeconds={telemetry.data?.bucketSeconds ?? null}
                          playheadTs={playheadTs}
                          onSeek={onSeek}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>
            )
          })}
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
