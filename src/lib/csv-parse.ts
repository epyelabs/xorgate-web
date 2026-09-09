// Minimal RFC 4180 CSV reader for the simulator's source preview: quoted
// fields (with "" escapes and embedded newlines), CRLF or LF, a header row.
// Numeric-looking cells stay strings; the preview shows the file as written.

export function parseCsv(text: string): {
  columns: string[]
  rows: string[][]
} {
  const records: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ",") {
      row.push(cell)
      cell = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(cell)
      cell = ""
      records.push(row)
      row = []
    } else cell += ch
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell)
    records.push(row)
  }
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ""))
  const [header = [], ...rows] = nonEmpty
  return { columns: header.map((h) => h.trim()), rows }
}
