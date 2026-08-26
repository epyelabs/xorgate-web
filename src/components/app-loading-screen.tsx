import { useEffect, useState } from "react"
import { XorgateLogo } from "@/components/xorgate-logo"
import { hasAppShellMounted } from "@/lib/app-shell"
import { cn } from "@/lib/utils"

/**
 * Full-screen brand hold for the moments the app has nothing to show yet:
 * revalidating the Cognito session on boot, and the initial route load while
 * /me and /workspaces are in flight. Mirrors the static boot splash in
 * index.html so a hard refresh reads as one continuous screen.
 *
 * `delayMs` keeps it invisible for a grace period so a bootstrap that resolves
 * in 80ms reads as instant rather than as a flashed spinner. The boot path
 * passes 0: it takes over from the index.html splash, which is already
 * showing, so appearing immediately is the seamless option.
 */
export function AppLoadingScreen({
  label = "Loading your workspace",
  delayMs = 0,
  className,
}: {
  label?: string
  /** Grace period before anything paints. 0 shows it immediately. */
  delayMs?: number
  className?: string
}) {
  const [visible, setVisible] = useState(delayMs === 0)

  useEffect(() => {
    if (delayMs === 0) return
    const timer = setTimeout(() => setVisible(true), delayMs)
    return () => clearTimeout(timer)
  }, [delayMs])

  return (
    <div
      role="status"
      aria-busy
      aria-live="polite"
      className={cn(
        "flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6",
        "transition-opacity duration-500 motion-reduce:transition-none",
        visible ? "opacity-100" : "opacity-0",
        className
      )}
    >
      <div className="flex items-center gap-2.5">
        <XorgateLogo className="size-7 animate-pulse text-primary motion-reduce:animate-none" />
        <span className="text-xl font-semibold tracking-tight">xorgate</span>
      </div>
      {/* Indeterminate sweep — the fetch has no measurable progress to report. */}
      <div
        aria-hidden
        className="h-0.5 w-44 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full w-1/3 animate-loading-bar rounded-full bg-primary" />
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}

/**
 * The router's `defaultPendingComponent`. Boot gets the full-screen brand hold;
 * every later transition gets a small delayed spinner inside the content area.
 *
 * No route declares a `loader`, so post-boot transitions resolve in microtasks
 * off memoized guards — the delay means those paint nothing at all, and only a
 * genuinely slow one ever shows the spinner.
 */
export function RoutePendingScreen() {
  if (!hasAppShellMounted()) return <AppLoadingScreen />
  return <InlineRoutePending />
}

function InlineRoutePending({ delayMs = 300 }: { delayMs?: number }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delayMs)
    return () => clearTimeout(timer)
  }, [delayMs])

  return (
    <div
      role="status"
      aria-busy
      aria-live="polite"
      className={cn(
        "flex flex-1 items-center justify-center p-6",
        "transition-opacity duration-300 motion-reduce:transition-none",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      <div
        aria-hidden
        className="h-0.5 w-44 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full w-1/3 animate-loading-bar rounded-full bg-primary" />
      </div>
      <span className="sr-only">Loading</span>
    </div>
  )
}
