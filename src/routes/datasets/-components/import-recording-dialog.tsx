import { useEffect, useState } from "react"
import { toast } from "sonner"
import type { Device, MediaSession } from "@xorgate/sdk"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SessionsList } from "@/components/session-pickers"
import { DeviceRadioList } from "@/routes/workflow-templates/-components/device-radio-list"
import { xg, xgMessage } from "@/lib/xorgate"
import { createRecordingImport } from "@/lib/models-api"
import { MAX_IMPORT_FRAMES, type DatasetDetail } from "@/lib/models-schemas"
import { useInvalidateModels } from "@/queries/models"
import { useWorkspaceStore } from "@/store/workspace"

const SESSION_PAGE = 50

// "Add from recording": the simulator's device and session picker, then a
// sampling rate and a frame cap. The import runs server-side (ffmpeg over the
// session's segments) and the Items tab shows it moving.
export function ImportRecordingDialog({
  dataset,
  open,
  onOpenChange,
}: {
  dataset: DatasetDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [device, setDevice] = useState<Device | null>(null)
  const [sessions, setSessions] = useState<MediaSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [everySeconds, setEverySeconds] = useState("2")
  const [maxFrames, setMaxFrames] = useState("100")
  const [submitting, setSubmitting] = useState(false)
  const invalidate = useInvalidateModels()
  const hasWorkspace = useWorkspaceStore((s) => s.currentWorkspaceId !== null)

  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setDevice(null)
    setSessions(null)
    setError(null)
    setSessionId(null)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open])

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
        const { items } = await xg().media.sessions.list(device.id, {
          limit: SESSION_PAGE,
          sort: "startedAt",
          order: "desc",
        })
        if (!cancelled) setSessions(items)
      } catch (err) {
        if (!cancelled) setError(xgMessage(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, device])

  const every = Number(everySeconds)
  const cap = Number(maxFrames)
  const everyError = !Number.isFinite(every) || every <= 0 ? "Sampling interval must be positive" : null
  const capError =
    !Number.isInteger(cap) || cap < 1 || cap > MAX_IMPORT_FRAMES
      ? `Frame cap must be between 1 and ${MAX_IMPORT_FRAMES}`
      : null
  const canConfirm = !!sessionId && !everyError && !capError && !submitting

  const handleConfirm = async () => {
    if (!sessionId) return
    setSubmitting(true)
    try {
      await createRecordingImport(dataset.id, { sessionId, everySeconds: every, maxFrames: cap })
      toast.success("Import queued", { description: "Frames appear in the grid as the import runs." })
      invalidate.dataset(dataset.id)
      onOpenChange(false)
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add frames from a recording</DialogTitle>
          <DialogDescription>
            Pick a device, then one of its on-device recording sessions. Frames are
            sampled at the interval below and added as unlabeled items.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {!hasWorkspace ? (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              Select a workspace first: recordings belong to a workspace's devices.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Device</span>
              <DeviceRadioList active={open} selectedId={device?.id ?? null} onSelect={setDevice} />
            </div>
          )}
          {device ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Recording session</span>
              <SessionsList
                sessions={sessions}
                error={error}
                selectedIds={sessionId ? [sessionId] : []}
                single
                onToggle={(id) => setSessionId((prev) => (prev === id ? null : id))}
              />
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="imp-every">Every (seconds)</Label>
              <Input id="imp-every" type="number" min={0.1} step="any" value={everySeconds} onChange={(e) => setEverySeconds(e.target.value)} />
              {everyError ? <span className="text-[11px] text-destructive">{everyError}</span> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="imp-max">At most (frames)</Label>
              <Input id="imp-max" type="number" min={1} max={MAX_IMPORT_FRAMES} value={maxFrames} onChange={(e) => setMaxFrames(e.target.value)} />
              {capError ? <span className="text-[11px] text-destructive">{capError}</span> : null}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            A 10-minute drive at every 2 s is 300 frames. Frames identical to ones already
            in the dataset are skipped. Frames from the same minute share a split group, so a
            version never puts near-duplicates on both sides of a split.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleConfirm()} disabled={!canConfirm} data-testid="import-submit">
            {submitting ? "Queuing…" : "Import frames"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
