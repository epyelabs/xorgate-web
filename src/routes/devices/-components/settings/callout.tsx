import type { ReactNode } from "react"
import { InfoIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * A short piece of context about a whole settings group — "this tab is display
 * only", "these keys need a reboot". Same muted-panel weight as the reported
 * strip on the Media tab, so settings-page asides read as one family rather
 * than as loose paragraphs of grey text.
 */
export function SettingsCallout({
  icon = <InfoIcon />,
  children,
  className,
}: {
  icon?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground",
        "[&_svg]:mt-px [&_svg]:size-3.5 [&_svg]:shrink-0",
        className
      )}
    >
      {icon}
      <div className="min-w-0">{children}</div>
    </div>
  )
}
