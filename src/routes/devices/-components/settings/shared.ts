// Shared bits for the device settings sub-tabs. Presentation only — option
// lists live with the tab that renders them, defaults live in
// @/lib/device-config-defaults, and the tab list itself in
// @/lib/device-settings-tabs (things outside this folder deep-link into it).

/**
 * Select options including a stored value that isn't in the preset list (e.g.
 * set via the API) so a select never displays a value it doesn't contain.
 */
export function withCurrent(options: number[], current: number): number[] {
  return options.includes(current)
    ? options
    : [...options, current].sort((a, b) => a - b)
}

/** Degrees input: "" and non-numeric are rejected (null), everything else parsed. */
export function parseAngle(s: string): number | null {
  if (s.trim() === "") return null
  const n = Number(s.trim())
  return Number.isFinite(n) ? n : null
}

/** "45 seconds" / "1 minute" / "5 minutes" — one formatter for every duration select. */
export function formatSeconds(s: number): string {
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`
  const mins = s / 60
  return `${mins} minute${mins === 1 ? "" : "s"}`
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

export function formatTimestamp(iso: string | null): string {
  if (!iso) return "Never"
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return dateTimeFormat.format(parsed)
}
