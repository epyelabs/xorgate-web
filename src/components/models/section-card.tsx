import type { ReactNode } from "react"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

// The one panel shape every Models page composes: a small Card with an
// optional title row (title, one-line description, a right-aligned action)
// and a content well. Pages only ever describe what goes in a section; the
// chrome is decided once here so datasets, jobs and registry entries read as
// one family.
export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
  testId,
}: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
  testId?: string
}) {
  const hasHeader = Boolean(title || description || action)
  return (
    <Card size="sm" className={cn("min-w-0", className)} data-testid={testId}>
      {hasHeader ? (
        <CardHeader>
          {title ? <CardTitle>{title}</CardTitle> : null}
          {description ? <CardDescription>{description}</CardDescription> : null}
          {action ? <CardAction>{action}</CardAction> : null}
        </CardHeader>
      ) : null}
      <CardContent className={cn("flex min-w-0 flex-col gap-3", contentClassName)}>{children}</CardContent>
    </Card>
  )
}
