/**
 * What a device's telemetry looks like when it is PLOTTED rather than read as
 * a single value.
 *
 * The replay readouts can put speed, altitude and CPU temperature next to each
 * other because each is one number with its unit printed beside it. A graph
 * cannot: a line only means something against a scale, and km/h, metres, °C,
 * dBm and volts share none. So every metric gets its OWN panel with its own
 * y-axis — including roll, pitch and yaw, which share a unit but not a useful
 * range: yaw wraps across the whole compass and flattened the other two into
 * straight lines when all three shared an axis.
 *
 * A panel never carries two units, and never a second y-axis.
 *
 * Related to `capability-metrics.ts`, which answers a different question: that
 * one says what a device MODEL can report, this one says which of those the
 * graph knows how to scale. The sheet intersects the two.
 */

/** Which tab a panel sits under, mirroring the live/replay readout groups. */
export type MetricSection = "GPS" | "Motion" | "System" | "Connectivity"

/** Tab order, and the only place the set is spelled out. */
export const METRIC_SECTIONS: MetricSection[] = [
  "GPS",
  "Motion",
  "System",
  "Connectivity",
]

export interface ChartMetric {
  /** The metric name as the device reports it and the API keys on. */
  metric: string
  /**
   * What the toggle chip says, and — on a multi-series panel — what its
   * legend entry says. On a single-series panel the panel title is the name,
   * so this is the same thing said shorter.
   */
  label: string
  /** Decimals in the tooltip. */
  precision: number
  /** Shown when the sheet first opens, before the operator picks. */
  defaultOn?: boolean
}

export interface ChartMetricGroup {
  id: string
  /** The tab this panel appears under. */
  section: MetricSection
  /** Names the panel; for a one-series panel it names the line too. */
  title: string
  /** Printed once on the panel, since every series in it shares this. */
  unit: string
  /**
   * The y-axis, as `[floor, ceiling]`.
   *
   * A percentage keeps its ZERO but not its 100: anchoring the floor is what
   * preserves "13% of capacity" at a glance, while a fixed ceiling spent the
   * whole plot on headroom the device never used — a CPU sitting at 7-15% was
   * a flat line along the bottom, which is the same fault that made roll
   * unreadable. The axis and the header's Max carry the absolute.
   *
   * Fixed both ends only where the SCALE itself is the meaning: course and yaw
   * are compass bearings, and auto-scaling one would disguise a wrap as
   * movement. `"auto"` where the range is genuinely open — altitude,
   * temperature, voltage — and the shape is the only story.
   */
  domain: [number | "auto", number | "auto"]
  metrics: ChartMetric[]
}

/**
 * Every metric the graph knows how to plot, in the order the readouts
 * introduce them: where the device was and how it was moving, then how the box
 * itself was holding up, then the link.
 *
 * Position is deliberately absent. `gps.lat`/`gps.lon` are a place, not a
 * quantity — two sawtooth lines that say far less than the route already drawn
 * on the map behind this sheet.
 *
 * `imu.quat_*`, `system.throttled` and `lte.gnss_health` are absent for the
 * same class of reason: a quaternion component is not a quantity anyone reads
 * off an axis (the Euler triple below is the same orientation in units a human
 * has intuitions about), and the other two are an enum and a bitmask, where a
 * line between two codes draws a value that never existed.
 */
export const TELEMETRY_GRAPH_GROUPS: ChartMetricGroup[] = [
  {
    id: "speed",
    section: "GPS",
    title: "Speed",
    unit: "km/h",
    domain: [0, "auto"],
    metrics: [
      { metric: "gps.speed", label: "Speed", precision: 1, defaultOn: true },
    ],
  },
  {
    id: "altitude",
    section: "GPS",
    title: "Altitude",
    unit: "m",
    domain: ["auto", "auto"],
    metrics: [
      { metric: "gps.alt", label: "Altitude", precision: 0, defaultOn: true },
    ],
  },
  {
    id: "satellites",
    section: "GPS",
    title: "Satellites used",
    unit: "",
    domain: [0, "auto"],
    metrics: [
      {
        metric: "gps.satellites",
        label: "Satellites used",
        precision: 0,
        defaultOn: true,
      },
    ],
  },
  {
    id: "satellites-in-view",
    section: "GPS",
    title: "Satellites in view",
    unit: "",
    domain: [0, "auto"],
    metrics: [
      {
        metric: "gps.satellites_in_view",
        label: "Satellites in view",
        precision: 0,
      },
    ],
  },
  {
    id: "hdop",
    section: "GPS",
    title: "HDOP",
    unit: "",
    domain: [0, "auto"],
    metrics: [{ metric: "gps.hdop", label: "HDOP", precision: 2 }],
  },
  {
    id: "ttff",
    section: "GPS",
    title: "Time to fix",
    unit: "s",
    domain: [0, "auto"],
    metrics: [{ metric: "gps.ttff_s", label: "Time to fix", precision: 0 }],
  },
  {
    // 0 and 360 are the same heading, so the line jumps the full height of the
    // plot every time the device drives north. Kept anyway — the wrap is
    // obvious once you know the axis is a compass, and the alternative
    // (unwrapping into a running bearing) invents values the device never sent.
    id: "course",
    section: "GPS",
    title: "Course",
    unit: "°",
    domain: [0, 360],
    metrics: [{ metric: "gps.course", label: "Course", precision: 0 }],
  },
  {
    // The one multi-line panel in the catalog, and the reason it is allowed to
    // be: the three axes share both a unit AND a range, so nothing is
    // flattened by sharing a scale, and reading them apart is exactly the
    // point. The colours come from slots 1-3, the three the palette holds to
    // the stricter all-pairs gate.
    id: "accel",
    section: "Motion",
    title: "Acceleration",
    unit: "m/s²",
    domain: ["auto", "auto"],
    metrics: [
      { metric: "imu.accel_x", label: "X", precision: 2 },
      { metric: "imu.accel_y", label: "Y", precision: 2 },
      { metric: "imu.accel_z", label: "Z", precision: 2 },
    ],
  },
  {
    // Roll and pitch get their own scale on purpose. Sharing one with yaw made
    // them straight lines: yaw is a compass bearing that swings the full ±180
    // on every wrap, so it set the axis and a 10° lean vanished against it.
    id: "roll",
    section: "Motion",
    title: "Roll",
    unit: "°",
    domain: ["auto", "auto"],
    metrics: [{ metric: "imu.euler_roll", label: "Roll", precision: 1 }],
  },
  {
    id: "pitch",
    section: "Motion",
    title: "Pitch",
    unit: "°",
    domain: ["auto", "auto"],
    metrics: [{ metric: "imu.euler_pitch", label: "Pitch", precision: 1 }],
  },
  {
    // Fixed, unlike the other two: 0 and 360 are the same heading, so the line
    // jumps the height of the plot every time the device drives north. On a
    // fixed ±180 that wrap is at least legible as a wrap; auto-scaling it to
    // whatever the session happened to reach would hide that it is one.
    id: "yaw",
    section: "Motion",
    title: "Yaw",
    unit: "°",
    domain: [-180, 180],
    metrics: [{ metric: "imu.euler_yaw", label: "Yaw", precision: 1 }],
  },
  {
    id: "cpu",
    section: "System",
    title: "CPU load",
    unit: "%",
    domain: [0, "auto"],
    metrics: [
      {
        metric: "system.cpu_usage",
        label: "CPU load",
        precision: 0,
        defaultOn: true,
      },
    ],
  },
  {
    id: "ram",
    section: "System",
    title: "RAM",
    unit: "%",
    domain: [0, "auto"],
    metrics: [{ metric: "system.ram_usage", label: "RAM", precision: 0 }],
  },
  {
    id: "disk",
    section: "System",
    title: "Disk",
    unit: "%",
    domain: [0, "auto"],
    metrics: [{ metric: "system.disk_usage", label: "Disk", precision: 0 }],
  },
  {
    id: "cpu-temp",
    section: "System",
    title: "CPU temperature",
    unit: "°C",
    domain: ["auto", "auto"],
    metrics: [
      {
        metric: "system.cpu_temp",
        label: "CPU temp",
        precision: 0,
        defaultOn: true,
      },
    ],
  },
  {
    // The brownout line, and half the reason this sheet exists: a drive that
    // ends in a reboot shows it here as the rail sagging minutes before.
    id: "rail",
    section: "System",
    title: "5 V rail",
    unit: "V",
    domain: ["auto", "auto"],
    metrics: [{ metric: "system.rail_5v", label: "5 V rail", precision: 2 }],
  },
  {
    // Negotiated once at boot and constant thereafter, so a flat line here is
    // the expected shape — what the supply PROMISED, against what the rail
    // above actually delivered.
    id: "psu",
    section: "System",
    title: "PSU max current",
    unit: "mA",
    domain: [0, "auto"],
    metrics: [
      {
        metric: "system.psu_max_current",
        label: "PSU max current",
        precision: 0,
      },
    ],
  },
  {
    id: "rssi",
    section: "Connectivity",
    title: "Signal (RSSI)",
    unit: "dBm",
    domain: ["auto", "auto"],
    metrics: [
      { metric: "lte.rssi", label: "RSSI", precision: 0, defaultOn: true },
    ],
  },
  {
    id: "quality",
    section: "Connectivity",
    title: "Signal quality",
    unit: "",
    domain: [0, "auto"],
    metrics: [{ metric: "lte.quality", label: "Signal quality", precision: 0 }],
  },
  {
    id: "modem-temp",
    section: "Connectivity",
    title: "Modem temperature",
    unit: "°C",
    domain: ["auto", "auto"],
    metrics: [{ metric: "lte.modem_temp", label: "Modem temp", precision: 0 }],
  },
  {
    // A counter, not a gauge: it steps up and never comes down inside a
    // replay, so what the line shows is WHEN the modem gave up, which is the
    // thing you are looking for next to an RSSI trough.
    id: "modem-resets",
    section: "Connectivity",
    title: "Modem resets (24 h)",
    unit: "",
    domain: [0, "auto"],
    metrics: [
      { metric: "lte.resets_24h", label: "Modem resets", precision: 0 },
    ],
  },
]

/** Flat view of the catalog, for lookups by metric name. */
export const CHART_METRICS: ReadonlyMap<string, ChartMetric> = new Map(
  TELEMETRY_GRAPH_GROUPS.flatMap((g) =>
    g.metrics.map((m) => [m.metric, m] as const)
  )
)

/** Every metric the catalog can draw, in panel order. */
export const CHART_METRIC_NAMES: string[] = [...CHART_METRICS.keys()]

/**
 * Seven categorical hues, led by the brand.
 *
 * Slot 1 is the xorgate orange, and the other six are hues chosen to sit with
 * it. They live in `index.css` as `--series-1..7`, with their own stepping
 * under `.dark` rather than a lightened flip of the light values.
 * Deliberately NOT `--chart-1..5`, which is five steps of gray: a magnitude
 * ramp, unusable for telling things apart.
 *
 * Seven is the count because the biggest tab (GPS) holds seven panels, so no
 * view ever needs an eighth.
 *
 * Which gates are HARD here depends on the form. Almost every panel is its own
 * chart with its own title, one line and its own y-axis, so nobody has to tell
 * one panel's line from another's by colour: hue is differentiation there, not
 * encoding, and the adjacent-pair gate is the operative one. Slots 1-3 are
 * held to the stricter all-pairs gate because the Acceleration panel draws
 * all three at once, where colour IS the encoding — its three axes are also
 * direct-labelled in the header strip, so identity never rests on hue alone.
 *
 * Validated in both themes against this sheet's popover surface; the numbers
 * are recorded beside the tokens in `index.css`.
 */
export const SERIES_SLOTS = 7

/** The CSS colour for a series' slot, resolved per theme by `index.css`. */
export function seriesColor(index: number): string {
  return `var(--series-${(index % SERIES_SLOTS) + 1})`
}

/**
 * Which slot a line takes.
 *
 * A panel with ONE line is coloured by where it sits in its tab, so a tab
 * reads as a sequence of distinct charts. A panel with several takes the first
 * slots in order instead, since there the colour is what tells them apart.
 */
export function seriesSlot(
  group: ChartMetricGroup,
  metric: ChartMetric
): number {
  if (group.metrics.length > 1) return group.metrics.indexOf(metric)
  return TELEMETRY_GRAPH_GROUPS.filter(
    (g) => g.section === group.section
  ).indexOf(group)
}

/** Fraction of the axis kept clear past the data, so a line never touches the frame. */
const HEADROOM = 0.15

/** Round numbers an axis bound may land on, per order of magnitude. */
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8]

/** Nice step sizes at or above `seed`, smallest first. */
function* niceSteps(seed: number): Generator<number> {
  const start = seed > 0 ? Math.floor(Math.log10(seed)) : 0
  for (let exponent = start; exponent < start + 4; exponent++) {
    for (const n of NICE_STEPS) {
      const step = n * 10 ** exponent
      if (step >= seed - 1e-12) yield step
    }
  }
}

/**
 * The y-axis a panel actually draws.
 *
 * Recharts' own `"auto"` ends the axis at the first round tick past the data,
 * which is headroom by accident rather than by intent: a 15% CPU peak landed
 * at 16 and sat a hair under the frame, while a 45% RAM peak landed at 60 and
 * had a third of the plot spare. Here each OPEN end is padded deliberately and
 * then snapped out to a round step, and the span is held to exactly four steps
 * so the five ticks stay whole numbers.
 *
 * The padding is measured from the fixed end where there is one. RAM sitting
 * at 19-22% has a span of 3 but a distance to the pinned zero of 22, and
 * padding the span would add almost nothing — it is the distance to the axis
 * that decides whether the trace looks cramped.
 */
export function axisDomain(
  domain: ChartMetricGroup["domain"],
  bounds: { min: number; max: number } | null
): [number | "auto", number | "auto"] {
  const [lo, hi] = domain
  const fixedLo = typeof lo === "number"
  const fixedHi = typeof hi === "number"
  // Nothing to compute: both ends given, or no data to measure against.
  if (!bounds || (fixedLo && fixedHi)) return domain

  const reference = fixedLo
    ? bounds.max - lo
    : fixedHi
      ? hi - bounds.min
      : bounds.max - bounds.min
  // A flat series has no span to pad, so fall back to its own magnitude.
  const spread = Math.abs(reference) || Math.abs(bounds.max) || 1
  const pad = spread * HEADROOM
  const wantMin = fixedLo ? lo : bounds.min - pad
  const wantMax = fixedHi ? hi : bounds.max + pad

  // Half a step is tried as well as a whole one. Snapping the floor to whole
  // steps alone can miss by a hair and force the NEXT step size — the 5 V rail
  // wanted 4.655-5.045, which a 0.1 step covers easily but only from 4.65, and
  // insisting on a multiple of 0.1 pushed it to a 0.15 step and 42% of the plot
  // left empty.
  for (const step of niceSteps((wantMax - wantMin) / 4)) {
    for (const snap of [step, step / 2]) {
      const low = fixedLo ? lo : Math.floor(wantMin / snap) * snap
      const high = low + 4 * step
      if (high >= wantMax - 1e-12) return [low, high]
    }
  }
  return [wantMin, wantMax]
}
