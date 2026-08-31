import * as React from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

/**
 * One place decides what an organization or a workspace looks like: its logo
 * if it has one, its initials otherwise. The sidebar switchers, their dropdowns
 * and the settings screen all render through this, so a freshly uploaded logo
 * cannot appear in one of them and not the others.
 *
 * `rounded-lg`, not the Avatar's default circle: a logo is a mark, not a face,
 * and cropping a wordmark into a circle is how it stops being readable. The
 * image is CONTAINED for the same reason (lib/image.ts fits it that way on
 * upload) — `object-cover` would crop the very edges the mark needs. The
 * Avatar's ring is an `after:` pseudo-element, so its radius is squared off
 * separately from the box's.
 *
 * The `key` on the root is load-bearing, not a list artefact. Radix's Avatar
 * keeps the image's loading status on the ROOT, and unmounting the image does
 * not reset it: removing a logo would leave a root that still believes it has
 * a loaded image, so the initials fallback stays hidden and the tile renders
 * blank. Keying on `src` remounts the root, which is what puts the status back
 * to idle.
 */
function initialsFor(name: string): string {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("")
  return initials || name.slice(0, 2).toUpperCase()
}

export function EntityLogo({
  name,
  src,
  className,
  fallbackClassName,
  ...props
}: {
  name: string
  src?: string | null
  /** The fallback is a separate element, so its colours are set separately. */
  fallbackClassName?: string
} & React.ComponentProps<typeof Avatar>) {
  return (
    <Avatar
      key={src ?? "none"}
      className={cn("rounded-lg after:rounded-lg", className)}
      {...props}
    >
      {/* Empty alt: the name is always rendered beside it, never only here. */}
      {src ? (
        <AvatarImage src={src} alt="" className="rounded-lg object-contain" />
      ) : null}
      <AvatarFallback
        className={cn(
          "rounded-lg bg-muted text-xs font-medium text-muted-foreground",
          fallbackClassName
        )}
      >
        {initialsFor(name)}
      </AvatarFallback>
    </Avatar>
  )
}
