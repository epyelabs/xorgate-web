import { useEffect, useState } from "react"
import { RadioIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { getKvsChannels, type Device, type KvsChannel } from "@/lib/api"
import { cn } from "@/lib/utils"
import { DeviceRadioList } from "./device-radio-list"
import { deviceLabel, type SourceBinding } from "./simulator-types"

// "Select live stream" for a video source: pick an online device, then one of its
// active KVS signaling channels (a live stream). Confirms into a `video-live`
// binding. Read-only — lists real devices/channels but never opens a viewer.
export function SourceLiveDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (binding: Extract<SourceBinding, { kind: "video-live" }>) => void
}) {
  const [device, setDevice] = useState<Device | null>(null)
  const [channels, setChannels] = useState<KvsChannel[] | null>(null)
  const [chError, setChError] = useState<string | null>(null)
  const [streamKey, setStreamKey] = useState<string | null>(null)

  // Reset selection each time the dialog opens.
  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setDevice(null)
    setChannels(null)
    setChError(null)
    setStreamKey(null)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open])

  // Load the chosen device's live streaming channels.
  useEffect(() => {
    if (!open || !device) return
    let cancelled = false
    /* eslint-disable react-hooks/set-state-in-effect */
    setChannels(null)
    setChError(null)
    setStreamKey(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    ;(async () => {
      try {
        const { channels: chs } = await getKvsChannels(device.id)
        if (!cancelled) setChannels(chs)
      } catch (err) {
        if (!cancelled) setChError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, device])

  const selected = channels?.find((c) => c.streamKey === streamKey) ?? null
  const canConfirm = !!device && !!selected

  const handleConfirm = () => {
    if (!device || !selected) return
    onConfirm({
      kind: "video-live",
      deviceId: device.id,
      deviceName: deviceLabel(device),
      channel: selected,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Select live stream</DialogTitle>
          <DialogDescription>
            Pick an online device, then one of its active streams to feed this
            video source.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Device</span>
            <DeviceRadioList
              active={open}
              selectedId={device?.id ?? null}
              onSelect={setDevice}
              filter={(d) => d.status === "online"}
              emptyLabel="No devices are online right now."
            />
          </div>

          {device ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Live stream</span>
              {chError ? (
                <p className="rounded-md border border-dashed border-destructive/50 px-3 py-4 text-center text-xs text-destructive">
                  Couldn&apos;t load streams: {chError}
                </p>
              ) : channels === null ? (
                <div className="flex flex-col gap-1">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : channels.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  This device has no active streams.
                </p>
              ) : (
                <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-md border border-border p-1">
                  {channels.map((c) => {
                    const on = c.streamKey === streamKey
                    return (
                      <button
                        key={c.streamKey}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() =>
                          setStreamKey((prev) =>
                            prev === c.streamKey ? null : c.streamKey,
                          )
                        }
                        className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                            on
                              ? "border-primary"
                              : "border-muted-foreground/40",
                          )}
                        >
                          {on ? (
                            <span className="size-2 rounded-full bg-primary" />
                          ) : null}
                        </span>
                        <RadioIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs text-foreground">
                            {c.streamKey}
                          </span>
                          <span className="block truncate font-mono text-[11px] text-muted-foreground">
                            {c.region}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-red-500">
                          <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
                          LIVE
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Only online devices expose an active stream.
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!canConfirm}>
            Use stream
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
