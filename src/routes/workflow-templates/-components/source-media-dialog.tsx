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
import { RecordingsList } from "@/components/recordings-list"
import { getDeviceRecordings, type Device, type Recording } from "@/lib/api"
import { DeviceRadioList } from "./device-radio-list"
import { deviceLabel, type SourceBinding } from "./simulator-types"

// "Select media from device" for a video source: pick a device, then one of its
// recordings. Confirms into a `video-recording` binding. Read-only — lists real
// devices/recordings but never starts or mutates anything.
export function SourceMediaDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (binding: Extract<SourceBinding, { kind: "video-recording" }>) => void
}) {
  const [device, setDevice] = useState<Device | null>(null)
  const [recordings, setRecordings] = useState<Recording[] | null>(null)
  const [recError, setRecError] = useState<string | null>(null)
  const [recId, setRecId] = useState<string | null>(null)

  // Reset selection each time the dialog opens.
  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setDevice(null)
    setRecordings(null)
    setRecError(null)
    setRecId(null)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open])

  // Load the chosen device's recordings.
  useEffect(() => {
    if (!open || !device) return
    let cancelled = false
    /* eslint-disable react-hooks/set-state-in-effect */
    setRecordings(null)
    setRecError(null)
    setRecId(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    ;(async () => {
      try {
        const { recordings: recs } = await getDeviceRecordings(device.id)
        if (!cancelled)
          setRecordings(
            [...recs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
          )
      } catch (err) {
        if (!cancelled) setRecError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, device])

  const selectedRec = recordings?.find((r) => r.id === recId) ?? null
  const canConfirm = !!device && !!selectedRec

  const handleConfirm = () => {
    if (!device || !selectedRec) return
    onConfirm({
      kind: "video-recording",
      deviceId: device.id,
      deviceName: deviceLabel(device),
      recording: selectedRec,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Select media from device</DialogTitle>
          <DialogDescription>
            Pick a device, then one of its recordings to feed this video source.
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
              <span className="text-xs font-medium">Recording</span>
              <RecordingsList
                recordings={recordings}
                recError={recError}
                selectedIds={recId ? [recId] : []}
                single
                onToggle={(id) => setRecId((prev) => (prev === id ? null : id))}
              />
              <p className="text-xs text-muted-foreground">
                Only completed recordings can be selected.
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
            Use recording
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
