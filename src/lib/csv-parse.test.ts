import { describe, expect, it } from "vitest"
import { parseCsv } from "./csv-parse"

describe("parseCsv", () => {
  it("reads a header and rows, LF or CRLF, ignoring blank lines", () => {
    expect(
      parseCsv("ts,gps.lat,gps.lon\r\n1,43.6,-79.5\n2,43.7,-79.4\n\n")
    ).toEqual({
      columns: ["ts", "gps.lat", "gps.lon"],
      rows: [
        ["1", "43.6", "-79.5"],
        ["2", "43.7", "-79.4"],
      ],
    })
  })
  it("handles quoted fields with commas, escaped quotes and newlines", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi""\nthere"\n')).toEqual({
      columns: ["a", "b"],
      rows: [["x, y", 'say "hi"\nthere']],
    })
  })
  it("returns no rows for an empty file", () => {
    expect(parseCsv("")).toEqual({ columns: [], rows: [] })
  })
})
