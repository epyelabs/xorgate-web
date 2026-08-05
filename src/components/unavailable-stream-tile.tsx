import { Link } from "@tanstack/react-router"
import { Card, CardContent } from "@/components/ui/card"
import type { UnavailableStreamDescriptor } from "@/lib/live-block"

/**
 * Stand-in for a grid cell that has no live stream to show, whatever the cause.
 *
 * Deliberately NOT a player, and this is the whole point rather than a styling
 * choice: in every case that reaches this component the device has no KVS
 * master running — the operator turned the camera off, or the device parked
 * every master to save power or shed heat. Mounting `useKvsViewer` against one
 * of those would produce a black tile plus an endless offer/timeout/backoff
 * loop against KVS + Cognito. Rendering this INSTEAD OF `<LiveVideoTile>` keeps
 * the hook unmounted, so nothing reconnects.
 *
 * The descriptor is plain data (see `lib/live-block.ts`), so a new cause — a
 * future `failed` master, a decommissioned device — is a new descriptor here,
 * not a new component and not a `switch` in the grid.
 */
export function UnavailableStreamTile({
  deviceId,
  descriptor,
}: {
  deviceId: string
  descriptor: UnavailableStreamDescriptor
}) {
  const Icon = descriptor.icon
  return (
    <Card className="overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="flex aspect-video max-h-[40vh] w-full flex-col items-center justify-center gap-2 bg-muted/40 px-6 text-center">
          <Icon aria-hidden="true" className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">{descriptor.title}</p>
          {descriptor.description ? (
            <p className="max-w-prose text-xs text-muted-foreground">
              {descriptor.description}
            </p>
          ) : null}
          {descriptor.detail || descriptor.note ? (
            <p className="text-xs text-muted-foreground/80">
              {/* Device prose, shown verbatim. It is the rationale that STARTED
                  the block and does not track live numbers — the current
                  temperature is on the Telemetry tab, not here. */}
              {descriptor.detail}
              {descriptor.detail && descriptor.note ? " · " : null}
              {descriptor.note}
            </p>
          ) : null}
          {descriptor.action ? (
            <Link
              to="/devices/$id/settings"
              params={{ id: deviceId }}
              className="text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
            >
              {descriptor.action.label}
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
