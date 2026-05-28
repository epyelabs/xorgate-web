export function formatRelative(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "—"
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return "—"
  const diffMs = now - t
  const sec = Math.max(0, Math.round(diffMs / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d`
  const wk = Math.round(day / 7)
  if (wk < 5) return `${wk}w`
  const mo = Math.round(day / 30)
  if (mo < 12) return `${mo}mo`
  const yr = Math.round(day / 365)
  return `${yr}y`
}

export function isOlderThan(iso: string | null, ms: number, now: number = Date.now()): boolean {
  if (!iso) return true
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return true
  return now - t > ms
}
