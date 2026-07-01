const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium", // "medium" includes seconds (e.g. "Jul 1, 2026, 2:41:05 PM")
})

// Absolute local date + time including seconds. Accepts an epoch-ms number or an
// ISO string; returns the input as-is when it isn't a valid date.
export function formatDateTime(ts: number | string): string {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? String(ts) : dateTimeFmt.format(d)
}
