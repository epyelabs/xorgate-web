import { cn } from "@/lib/utils"
import { ITEM_STATUS_COLOR, ITEM_STATUS_LABEL } from "@/lib/models-format"
import type { ItemStatus } from "@/lib/models-schemas"

// How far a dataset's labeling has come: one stacked bar over every item,
// labeled first so the "ready" share reads left to right, with a legend of
// counts. Excluded items sit at the end since they never train.
const ORDER: readonly ItemStatus[] = ["labeled", "ai_labeled", "unlabeled", "excluded"]

export function LabelProgress({
  counts,
  total,
  legend = true,
  className,
  testId,
}: {
  counts: Record<string, number>
  total: number
  legend?: boolean
  className?: string
  testId?: string
}) {
  const labeled = counts.labeled ?? 0
  const pct = total > 0 ? Math.round((labeled / total) * 100) : 0
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)} data-testid={testId}>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${labeled} of ${total} items labeled`}
        title={`${pct}% labeled`}
      >
        {total > 0
          ? ORDER.map((s) =>
              counts[s] ? (
                <div
                  key={s}
                  className={cn("h-full", ITEM_STATUS_COLOR[s], s === "unlabeled" ? "opacity-40" : "")}
                  style={{ width: `${(counts[s] / total) * 100}%` }}
                />
              ) : null,
            )
          : null}
      </div>
      {legend ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="font-medium tabular-nums">
            {total} item{total === 1 ? "" : "s"}
          </span>
          {ORDER.map((s) =>
            counts[s] ? (
              <span key={s} className="inline-flex items-center gap-1.5 text-muted-foreground" data-status={s}>
                <span className={cn("size-1.5 rounded-full", ITEM_STATUS_COLOR[s])} />
                <span className="tabular-nums text-foreground">{counts[s]}</span> {ITEM_STATUS_LABEL[s]}
              </span>
            ) : null,
          )}
          {total > 0 ? <span className="ml-auto text-muted-foreground tabular-nums">{pct}% labeled</span> : null}
        </div>
      ) : null}
    </div>
  )
}
