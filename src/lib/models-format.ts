import type {
  ItemStatus,
  TrainingJob,
  TrainingStatus,
} from "./models-schemas"

// Presentation helpers shared by the Models pages (datasets, training,
// registry). Pure: no React, no fetch.

export const JOB_STATUS_COLOR: Record<TrainingStatus, string> = {
  queued: "bg-zinc-400",
  dispatched: "bg-sky-500",
  running: "bg-sky-500",
  succeeded: "bg-emerald-500",
  failed: "bg-red-500",
  cancelled: "bg-amber-500",
}

export const ITEM_STATUS_COLOR: Record<ItemStatus, string> = {
  unlabeled: "bg-zinc-400",
  ai_labeled: "bg-violet-500",
  labeled: "bg-emerald-500",
  excluded: "bg-red-400",
}

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  unlabeled: "unlabeled",
  ai_labeled: "pre-labeled",
  labeled: "labeled",
  excluded: "excluded",
}

export const VERSION_STATUS_COLOR: Record<string, string> = {
  building: "bg-sky-500",
  ready: "bg-emerald-500",
  failed: "bg-red-500",
}

export const IMPORT_STATUS_COLOR: Record<string, string> = {
  queued: "bg-zinc-400",
  running: "bg-sky-500",
  succeeded: "bg-emerald-500",
  failed: "bg-red-500",
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? iso : dateTimeFormat.format(parsed)
}

/** A metric in [0, 1] as a fixed four-decimal number; a zero is a real value, not a blank. */
export function formatMetric(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—"
  return v.toFixed(digits)
}

export function formatPercent(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—"
  return `${(v * 100).toFixed(digits)}%`
}

/** Seconds as "1m 49s" / "59s"; used for wall time and billable time side by side. */
export function formatSeconds(s: number | null | undefined): string {
  if (s === null || s === undefined || s < 0) return "—"
  const total = Math.round(s)
  if (total < 60) return `${total}s`
  const min = Math.floor(total / 60)
  const sec = total % 60
  return sec === 0 ? `${min}m` : `${min}m ${sec}s`
}

/**
 * Wall time of a job as the user experienced it: from the POST that created
 * the row to the terminal state, in seconds (null until it ended). It
 * includes provisioning, the image pull and the finalizer lag, which is why
 * it sits well above the billable seconds (M3 measured 170 s against 109 s).
 */
export function jobWallSeconds(job: Pick<TrainingJob, "endedAt" | "createdAt">): number | null {
  if (!job.endedAt) return null
  return (new Date(job.endedAt).getTime() - new Date(job.createdAt).getTime()) / 1000
}

/** "Train fixture-vehicles v5" or "Assist (yolov8n@1)". */
export function jobTitle(job: Pick<TrainingJob, "task" | "output"> & { spec?: unknown }): string {
  if (job.task === "train") {
    const out = job.output
    return out ? `Train ${out.name}${out.version ? ` v${out.version}` : ""}` : "Train"
  }
  const spec = job.spec as { model?: { name?: string } } | null | undefined
  return spec?.model?.name ? `Assist (${spec.model.name})` : "Assist"
}

export function shortId(id: string): string {
  return id.slice(0, 8)
}

/** Loose phase label for the list: the progress tail's phase wins over the row's. */
export function jobPhase(job: Pick<TrainingJob, "progress" | "status">): string | null {
  const phase = job.progress?.phase ?? null
  if (phase && phase !== job.status) return phase
  return null
}

/** Status words as the pages print them; the raw enum stays in data attributes. */
export const JOB_STATUS_LABEL: Record<TrainingStatus, string> = {
  queued: "Queued",
  dispatched: "Provisioning",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
}

export const VERSION_STATUS_LABEL: Record<string, string> = {
  building: "Building",
  ready: "Ready",
  failed: "Failed",
}

export const IMPORT_STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Importing",
  succeeded: "Imported",
  failed: "Failed",
}

/** Localized integer with thousands separators. */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  return new Intl.NumberFormat().format(n)
}
