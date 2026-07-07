import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

// Pins a page's top region (its header, plus the tab bar on detail pages) just
// below the app shell's sticky header while the page body scrolls beneath.
// top-16 matches the shell header's h-16; collapsing the sidebar to icon mode
// shrinks the shell header to h-12, mirrored here with top-12 via the same
// group/sidebar-wrapper condition (they stay in lockstep). -mx-4 px-4 cancels
// the page's p-4 gutter so the opaque bg / bottom border span the full width.
export function StickyHeader({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      data-slot="sticky-header"
      className={cn(
        "sticky top-16 z-20 -mx-4 bg-background px-4 group-has-data-[collapsible=icon]/sidebar-wrapper:top-12",
        className
      )}
    >
      {children}
    </div>
  )
}
