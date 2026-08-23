import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { AgentBuild as LatestAgentBuild } from "@xorgate/sdk"
import type { ReportedAgentBuild } from "@/lib/device-config-status"
import { formatTimestamp } from "./settings/shared"

/**
 * Confirm installing the latest agent build (device_update_management, Phase 4).
 *
 * The row that launches this only has room for the version string, so the
 * detail lives here: what is installed, what would be installed, and what the
 * device does for the next minute or two. Modelled on RebootDeviceDialog —
 * same props contract, same "disabled while the request is in flight" posture.
 */
export function UpdateDeviceDialog({
  open,
  onOpenChange,
  deviceName,
  installed,
  latest,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  deviceName: string
  /** The build the device reports running; null if it has never reported one. */
  installed: ReportedAgentBuild | null
  /** The newest published build, or null when the manifest is unavailable. */
  latest: LatestAgentBuild | null
  onConfirm: () => Promise<void> | void
}) {
  const [sending, setSending] = useState(false)

  // String equality, never ordering: a sha has no order, and a dev sha and a
  // prod release tag are not comparable at all.
  const upToDate =
    latest !== null && installed !== null && latest.version === installed.version

  async function handleConfirm() {
    setSending(true)
    try {
      await onConfirm()
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={sending ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {upToDate ? "Reinstall agent build" : "Update device agent"}
          </DialogTitle>
          <DialogDescription>
            This downloads the latest published build onto{" "}
            <span className="text-foreground font-medium">{deviceName}</span>,
            installs it, and restarts the agent. The device drops offline for
            roughly a minute or two. If the install fails it rolls back and the
            device stays on its current build.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Installed</dt>
          <dd className="min-w-0">
            <span className="font-mono">{installed?.version ?? "unknown"}</span>
            {installed?.channel !== null && installed?.channel !== undefined && (
              <span className="text-muted-foreground"> ({installed.channel})</span>
            )}
            {installed?.builtAt && (
              <div className="text-muted-foreground text-xs">
                built {formatTimestamp(installed.builtAt)}
              </div>
            )}
          </dd>

          <dt className="text-muted-foreground">Latest</dt>
          <dd className="min-w-0">
            {latest === null ? (
              <span className="text-muted-foreground">
                unknown — no published build manifest
              </span>
            ) : (
              <>
                <span className="font-mono">{latest.version}</span>
                {latest.channel && (
                  <span className="text-muted-foreground"> ({latest.channel})</span>
                )}
                {latest.builtAt && (
                  <div className="text-muted-foreground text-xs">
                    built {formatTimestamp(latest.builtAt)}
                  </div>
                )}
              </>
            )}
          </dd>
        </dl>

        {upToDate && (
          <p className="text-muted-foreground text-sm">
            This device already runs the latest build. Continuing reinstalls the
            same version, which is harmless.
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={sending}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleConfirm} disabled={sending}>
            {sending
              ? "Sending..."
              : upToDate
                ? "Reinstall build"
                : "Update device"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
