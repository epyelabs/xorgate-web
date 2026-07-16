import type { CSSProperties } from "react"

// Shared grid for the Map View's metric cards: one equal-width column per
// metric, so a card's metrics sit on a single row and the last group lands flush
// right.
//
// The column count is driven by the metric count (via --metric-cols) rather than
// by `auto-fit`, which sizes columns from the available width and so decides for
// itself where to wrap — that splits a two-metric group like Signal across rows,
// which is exactly what the right-hand placement is meant to avoid.
//
// Below `@lg` there isn't room for a column per metric, so it falls back to
// wrapping. Breakpoints are container-relative: these cards sit in a half-screen
// column, so viewport widths would badly misjudge the room available.
export const METRIC_GRID =
  "grid gap-x-5 gap-y-2 grid-cols-2 @sm:grid-cols-3 @lg:[grid-template-columns:repeat(var(--metric-cols),minmax(0,1fr))]"

// Pairs with METRIC_GRID: tells it how many columns to draw at `@lg` and up.
export function metricGridStyle(count: number): CSSProperties {
  return { "--metric-cols": count } as CSSProperties
}
