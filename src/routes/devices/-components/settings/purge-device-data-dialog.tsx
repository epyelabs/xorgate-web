import { useState } from "react"
import { toast } from "sonner"
import { isXorgateError } from "@xorgate/sdk"
import type { Device } from "@xorgate/sdk"
import { DestroyDialog } from "@/components/destroy-dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DEVICE_PURGE_SCOPES,
  PURGE_IN_PROGRESS,
  createDevicePurge,
  type DevicePurge,
  type DevicePurgePreview,
  type DevicePurgeScope,
} from "@/lib/device-purge-api"
import { xgMessage } from "@/lib/xorgate"
import { useDevicePurgePreview } from "@/queries/device-purges"

const SCOPE_LABEL: Record<DevicePurgeScope, string> = {
  workflows: "Workflows",
  telemetry: "Telemetry",
  media: "Media",
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
const formatDay = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d)
}

/** "1 run" / "3 runs" — the counts read as a sentence, not a table. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

/** The line under each scope: what that scope would delete right now. */
export function scopeSummary(
  scope: DevicePurgeScope,
  preview: DevicePurgePreview
): string {
  switch (scope) {
    case "workflows":
      return `${preview.workflows.attachments.toLocaleString()} attached, ${plural(preview.workflows.runs, "run")} (instances) and their artifacts`
    case "telemetry": {
      const sessions = plural(preview.telemetry.sessions, "recorded session")
      const { readingsFrom, readingsTo } = preview.telemetry
      return readingsFrom && readingsTo
        ? `${sessions}, readings from ${formatDay(readingsFrom)} to ${formatDay(readingsTo)}`
        : `${sessions}, no recorded telemetry`
    }
    case "media":
      return `${plural(preview.media.sessions, "recording")} and thumbnails`
  }
}

/**
 * The typed-name confirmation for a purge (README §3d). Three scope
 * checkboxes, all on by default, each captioned with what it would delete
 * right now. The counts are decoration: the preview may still be loading or
 * may have failed, and the typed name is the gate either way.
 */
export function PurgeDeviceDataDialog({
  open,
  onOpenChange,
  device,
  onStarted,
  onAlreadyRunning,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  device: Device
  /** The 202 body: the caller starts polling it. */
  onStarted: (purge: DevicePurge) => void
  /** A 409 from the API: the caller refreshes what it knows. */
  onAlreadyRunning: () => void
}) {
  const preview = useDevicePurgePreview(device.id, open)
  const [scopes, setScopes] = useState<DevicePurgeScope[]>([
    ...DEVICE_PURGE_SCOPES,
  ])

  function handleOpenChange(next: boolean) {
    // Re-arm every scope for the next opening; a partial choice is not
    // something to remember across dialogs.
    if (!next) setScopes([...DEVICE_PURGE_SCOPES])
    onOpenChange(next)
  }

  function toggle(scope: DevicePurgeScope, checked: boolean) {
    setScopes((prev) =>
      checked
        ? DEVICE_PURGE_SCOPES.filter((s) => s === scope || prev.includes(s))
        : prev.filter((s) => s !== scope)
    )
  }

  async function confirm() {
    let purge: DevicePurge
    try {
      purge = (await createDevicePurge(device.id, scopes)).purge
    } catch (err) {
      if (isXorgateError(err) && String(err.code) === PURGE_IN_PROGRESS) {
        toast.error("A purge is already running")
        onAlreadyRunning()
        handleOpenChange(false)
        return
      }
      toast.error(xgMessage(err))
      return
    }
    toast.success("Purge started")
    handleOpenChange(false)
    onStarted(purge)
  }

  return (
    <DestroyDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Purge device data"
      description={
        <>
          Delete the history of{" "}
          <span className="font-medium text-foreground">
            {device.name ?? device.serial}
          </span>{" "}
          up to now. The device, its identity, live streams and settings stay.
        </>
      }
      warning={
        <>
          <span className="font-medium text-foreground">
            This cannot be undone.
          </span>{" "}
          A recording in progress will be cut short; stop recording first.
        </>
      }
      confirmText={device.name ?? device.serial}
      confirmLabel="Purge data"
      pendingLabel="Starting…"
      confirmDisabled={scopes.length === 0}
      onConfirm={confirm}
    >
      <fieldset className="flex flex-col gap-3" data-testid="purge-scopes">
        <legend className="sr-only">What to purge</legend>
        {DEVICE_PURGE_SCOPES.map((scope) => {
          const id = `purge-scope-${scope}`
          return (
            <div key={scope} className="flex items-start gap-3">
              <Checkbox
                id={id}
                checked={scopes.includes(scope)}
                onCheckedChange={(checked) => toggle(scope, checked === true)}
                className="mt-0.5"
                data-testid={id}
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <Label htmlFor={id} className="text-sm font-medium">
                  {SCOPE_LABEL[scope]}
                </Label>
                {preview.data ? (
                  <p
                    className="text-xs text-muted-foreground"
                    data-testid={`${id}-summary`}
                  >
                    {scopeSummary(scope, preview.data)}
                  </p>
                ) : preview.isError ? (
                  <p className="text-xs text-muted-foreground">
                    Counts unavailable
                  </p>
                ) : (
                  <Skeleton className="h-3.5 w-56" />
                )}
              </div>
            </div>
          )
        })}
      </fieldset>
    </DestroyDialog>
  )
}
