import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { listDevices, type Device } from "@/lib/api"
import { cn } from "@/lib/utils"
import { deviceLabel } from "./simulator-types"

// Radio list of the workspace's devices, loaded from the real (read-only)
// listDevices API. Shared by the "Select media from device" and "Select Device"
// source pickers in the simulator pane. Loads when `active` flips true (i.e. the
// hosting dialog opens) so a closed dialog does no work.
export function DeviceRadioList({
  active,
  selectedId,
  onSelect,
}: {
  active: boolean
  selectedId: string | null
  onSelect: (device: Device) => void
}) {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    /* eslint-disable react-hooks/set-state-in-effect */
    setDevices(null)
    setError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    ;(async () => {
      try {
        // Page through the whole fleet so the picker isn't capped at one page.
        const all: Device[] = []
        let offset = 0
        let total = Infinity
        while (offset < total && all.length < 5000) {
          const { devices, page } = await listDevices({ limit: 500, offset })
          all.push(...devices)
          total = page?.total ?? devices.length
          if (devices.length === 0) break
          offset += 500
        }
        if (!cancelled) setDevices(all)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active])

  if (error) {
    return (
      <p className="rounded-md border border-dashed border-destructive/50 px-3 py-4 text-center text-xs text-destructive">
        Couldn&apos;t load devices: {error}
      </p>
    )
  }
  if (devices === null) {
    return (
      <div className="flex flex-col gap-1">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }
  if (devices.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
        No devices in this workspace yet.
      </p>
    )
  }
  return (
    <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-md border border-border p-1">
      {devices.map((d) => {
        const on = d.id === selectedId
        return (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onSelect(d)}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                on ? "border-primary" : "border-muted-foreground/40",
              )}
            >
              {on ? <span className="size-2 rounded-full bg-primary" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-foreground">
                {deviceLabel(d)}
              </span>
              <span className="block truncate font-mono text-xs text-muted-foreground">
                {d.serial}
              </span>
            </span>
            <Badge variant="outline">{d.status}</Badge>
          </button>
        )
      })}
    </div>
  )
}
