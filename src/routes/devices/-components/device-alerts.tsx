import { useState } from "react"
import { CircleAlertIcon, TriangleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

// Generic per-device alert model. Anything that needs the operator's
// attention (recording data loss, future: cert expiry, disk pressure, failed
// commands…) becomes a DeviceAlert and surfaces through the header's alert
// button instead of an inline banner on some tab.
export interface DeviceAlert {
  id: string
  severity: "warning" | "error"
  title: string
  description?: string
  // Monotonic "how bad is it" value (e.g. a cumulative counter). Dismissing
  // an alert stores this value; the alert stays hidden until the watermark
  // grows past the dismissed value — i.e. the condition got WORSE, not just
  // persisted. Omit for boolean conditions (treated as 1).
  watermark?: number
}

// Dismissals are client-side acknowledgments (the underlying counters live on
// the device and are cumulative — there is nothing to "clear" at the source).
// Persisted per device in localStorage so they survive reloads on this
// browser; other browsers/operators see the alert until they dismiss it too.
function ackStorageKey(deviceId: string): string {
  return `xorgate.deviceAlerts.ack.${deviceId}`
}

function loadAcks(deviceId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(ackStorageKey(deviceId))
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(
          ([, v]) => typeof v === "number"
        )
      ) as Record<string, number>
    }
  } catch {
    // corrupt/unavailable storage — treat as no acknowledgments
  }
  return {}
}

function saveAcks(deviceId: string, acks: Record<string, number>): void {
  try {
    localStorage.setItem(ackStorageKey(deviceId), JSON.stringify(acks))
  } catch {
    // storage unavailable (private mode/quota) — dismissal lasts this session
  }
}

// Header icon button + side sheet. The button is always present; a colored
// dot (amber = warnings, red = any error) appears only when something needs
// attention. Clicking it opens the alert sheet, where each alert can be
// dismissed (acknowledged).
export function DeviceAlertsButton({
  deviceId,
  alerts,
}: {
  deviceId: string
  alerts: DeviceAlert[]
}) {
  const [open, setOpen] = useState(false)
  const [acks, setAcks] = useState<Record<string, number>>(() =>
    loadAcks(deviceId)
  )

  // Re-read acknowledgments when navigating between devices — render-time
  // state adjustment (React's "adjusting state when a prop changes" pattern),
  // not an effect, so there is no flash of the previous device's acks.
  const [ackedDeviceId, setAckedDeviceId] = useState(deviceId)
  if (ackedDeviceId !== deviceId) {
    setAckedDeviceId(deviceId)
    setAcks(loadAcks(deviceId))
  }

  const visible = alerts.filter((a) => (acks[a.id] ?? -1) < (a.watermark ?? 1))
  const hasError = visible.some((a) => a.severity === "error")

  function dismiss(alert: DeviceAlert) {
    const next = { ...acks, [alert.id]: alert.watermark ?? 1 }
    setAcks(next)
    saveAcks(deviceId, next)
  }

  // Nothing to show → no button at all. Keep rendering while the sheet is
  // open, though, so dismissing the last alert doesn't yank the sheet away
  // mid-interaction — it disappears once the user closes it.
  if (visible.length === 0 && !open) return null

  return (
    <>
      <span className="relative inline-flex">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={
            visible.length === 0
              ? "Device alerts (none)"
              : `Device alerts (${visible.length})`
          }
          onClick={() => setOpen(true)}
        >
          <TriangleAlertIcon />
        </Button>
        {visible.length > 0 ? (
          // Overhangs the button's corner slightly. z-10 keeps it painting
          // above adjacent header buttons (which otherwise draw over the
          // overhang and look like they clip it).
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute -top-0.5 -right-0.5 z-10 h-2 w-2 animate-pulse rounded-full",
              hasError ? "bg-red-500" : "bg-amber-500"
            )}
          />
        ) : null}
      </span>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0">
          <SheetHeader className="gap-1 border-b border-border pb-3">
            <SheetTitle className="pr-8">Device alerts</SheetTitle>
            <SheetDescription>
              Conditions on this device that may need your attention.
              Dismissed alerts return if the condition recurs or gets worse.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No warnings or errors right now.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {visible.map((a) => (
                  <li
                    key={a.id}
                    className={cn(
                      "flex flex-col gap-2 rounded-md border px-3 py-2.5",
                      a.severity === "error"
                        ? "border-red-500/40 bg-red-500/10"
                        : "border-amber-500/40 bg-amber-500/10"
                    )}
                  >
                    <div className="flex gap-3">
                      <CircleAlertIcon
                        className={cn(
                          "mt-0.5 size-4 shrink-0",
                          a.severity === "error"
                            ? "text-red-600 dark:text-red-400"
                            : "text-amber-600 dark:text-amber-400"
                        )}
                      />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <p className="text-sm font-medium">{a.title}</p>
                        {a.description ? (
                          <p className="text-xs text-muted-foreground">
                            {a.description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => dismiss(a)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
