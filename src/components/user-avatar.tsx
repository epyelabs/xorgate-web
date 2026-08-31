import * as React from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

/**
 * One place decides what a person looks like: their picture if they have one,
 * their initials otherwise, and the email's first two characters when there is
 * no name to take initials from. The sidebar, its dropdown and the account
 * screen all render through this, so a freshly uploaded picture cannot appear
 * in one of them and not the others.
 */
function initialsFor(name: string | null, email: string): string {
  // A name that IS the email (the sidebar's fallback when the profile has no
  // name) would otherwise yield the first letters of the local part, which
  // reads as noise; treat it as no name at all.
  const usable = name && name !== email ? name : ""
  const fromName = usable
    .split(/\s+/)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("")
  return fromName || email.slice(0, 2).toUpperCase()
}

export function UserAvatar({
  name,
  email,
  src,
  fallbackClassName,
  ...props
}: {
  name: string | null
  email: string
  src?: string | null
  /** The fallback is a separate element, so its corner radius is set separately. */
  fallbackClassName?: string
} & React.ComponentProps<typeof Avatar>) {
  return (
    <Avatar {...props}>
      {/* Empty alt: the name is always rendered beside it, never only here. */}
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback className={fallbackClassName}>
        {initialsFor(name, email)}
      </AvatarFallback>
    </Avatar>
  )
}
