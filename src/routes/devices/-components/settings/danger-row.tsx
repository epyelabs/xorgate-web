import type { ReactNode } from "react"

/**
 * One action inside the Danger zone card: a bold label and a one-sentence
 * description on the left, the destructive button on the right. Stacks on a
 * narrow viewport so the button never squeezes the copy.
 */
export function DangerRow({
  title,
  description,
  detail,
  action,
  testId,
}: {
  title: string
  description: ReactNode
  /** An optional muted status line under the description (last purged, in progress). */
  detail?: ReactNode
  action: ReactNode
  testId?: string
}) {
  return (
    <div
      className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
      data-testid={testId}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs/relaxed text-muted-foreground">{description}</p>
        {detail ? (
          <p className="text-xs text-muted-foreground">{detail}</p>
        ) : null}
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}
