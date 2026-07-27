import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SessionsList } from "@/components/session-pickers"
import { getDeviceSessions, type Device, type MediaSession } from "@/lib/api"
import { DeviceRadioList } from "./device-radio-list"
import { deviceLabel, type SourceBinding } from "./simulator-types"

// How many of the device's most recent sessions the picker offers. The Media
// tab is the place to go hunting through everything; this is "pick something
// recent to simulate over".
const SESSION_PAGE = 50

// "Select media from device" for a video source: pick a device, then one of its
// on-device recording sessions. Confirms into a `video-session` binding, which
// the backend resolves to that session's ordered segment list (the same media
// path a triggered run takes). Read-only — lists real devices/sessions but
// never starts or mutates anything.
export function SourceMediaDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (binding: Extract<SourceBinding, { kind: "video-session" }>) => void
}) {
  const [device, setDevice] = useState<Device | null>(null)
  const [sessions, setSessions] = useState<MediaSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)

  // Reset selection each time the dialog opens.
  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setDevice(null)
    setSessions(null)
    setError(null)
    setSessionId(null)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open])

  // Load the chosen device's sessions, newest first (server-side sort).
  useEffect(() => {
    if (!open || !device) return
    let cancelled = false
    /* eslint-disable react-hooks/set-state-in-effect */
    setSessions(null)
    setError(null)
    setSessionId(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    ;(async () => {
      try {
        const { sessions: rows } = await getDeviceSessions(device.id, {
          limit: SESSION_PAGE,
          sort: "startedAt",
          order: "desc",
        })
        if (!cancelled) setSessions(rows)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, device])

  const selected = sessions?.find((s) => s.id === sessionId) ?? null
  const canConfirm = !!device && !!selected

  const handleConfirm = () => {
    if (!device || !selected) return
    onConfirm({
      kind: "video-session",
      deviceId: device.id,
      deviceName: deviceLabel(device),
      session: selected,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Select media from device</DialogTitle>
          <DialogDescription>
            Pick a device, then one of its on-device recording sessions to feed
            this video source.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Device</span>
            <DeviceRadioList
              active={open}
              selectedId={device?.id ?? null}
              onSelect={setDevice}
            />
          </div>

          {device ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Recording session</span>
              <SessionsList
                sessions={sessions}
                error={error}
                selectedIds={sessionId ? [sessionId] : []}
                single
                onToggle={(id) =>
                  setSessionId((prev) => (prev === id ? null : id))
                }
              />
              <p className="text-xs text-muted-foreground">
                The run decodes every segment in the session, each anchored at
                its own recorded timestamp.
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
            Use session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
