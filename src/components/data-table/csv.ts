// Shared CSV helpers for the standard "Export CSV" table action.

// Quote a field if it contains a comma, quote, or newline (RFC 4180).
export function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Serialize a header row + data rows into a CSV string.
export function toCsv(
  header: (string | number)[],
  rows: (string | number | null | undefined)[][]
): string {
  const lines = [header.map(csvCell).join(",")]
  for (const row of rows) lines.push(row.map(csvCell).join(","))
  return lines.join("\n")
}

// Trigger a browser download of `csv` as `filename`.
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
