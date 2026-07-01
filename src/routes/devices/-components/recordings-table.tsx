import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  deleteRecording,
  getRecordingPlaybackUrl,
  type Recording,
  type RecordingStatus,
} from "@/lib/api"

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? iso : dateTimeFormat.format(parsed)
}

function formatDuration(rec: Recording): string {
  let ms = rec.durationMs
  if (ms == null && rec.endedAt) {
    ms = new Date(rec.endedAt).getTime() - new Date(rec.startedAt).getTime()
  }
  if (ms == null || ms < 0) return "—"
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const STATUS_VARIANT: Record<
  RecordingStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  completed: "default",
  recording: "secondary",
  stopping: "outline",
  failed: "destructive",
}

// Shared recordings table with inline playback + delete. Used by the Media
// Recordings tab (full list) and the device Overview (recent few). The parent
// owns fetching + the null/empty states; this renders the rows and dialogs and
// calls `onChanged` after a successful delete so the parent can refresh.
export function RecordingsTable({
  deviceId,
  recordings,
  onChanged,
}: {
  deviceId: string
  recordings: Recording[]
  onChanged?: () => void | Promise<void>
}) {
  const [playing, setPlaying] = useState<Recording | null>(null)
  const [playUrl, setPlayUrl] = useState<string | null>(null)
  const [playLoading, setPlayLoading] = useState(false)

  const [deleting, setDeleting] = useState<Recording | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  async function openPlayer(rec: Recording) {
    setPlaying(rec)
    setPlayUrl(null)
    setPlayLoading(true)
    try {
      const { url } = await getRecordingPlaybackUrl(deviceId, rec.id)
      setPlayUrl(url)
    } catch (err) {
      toast.error((err as Error).message)
      setPlaying(null)
    } finally {
      setPlayLoading(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await deleteRecording(deviceId, deleting.id)
      toast.success("Recording deleted")
      setDeleting(null)
      await onChanged?.()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stream</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Trigger</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recordings.map((rec) => (
            <TableRow key={rec.id}>
              <TableCell className="font-mono">{rec.streamKey}</TableCell>
              <TableCell>{formatTimestamp(rec.startedAt)}</TableCell>
              <TableCell>{formatDuration(rec)}</TableCell>
              <TableCell>{formatSize(rec.sizeBytes)}</TableCell>
              <TableCell className="capitalize">{rec.trigger}</TableCell>
              <TableCell>
                <Badge
                  variant={STATUS_VARIANT[rec.status]}
                  className="capitalize"
                >
                  {rec.status === "recording" && rec.captureStartedAt === null
                    ? "Starting…"
                    : rec.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={rec.status !== "completed"}
                    onClick={() => void openPlayer(rec)}
                  >
                    Play
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setDeleting(rec)}
                  >
                    Delete
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Playback dialog */}
      <Dialog
        open={playing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPlaying(null)
            setPlayUrl(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {playing
                ? `${playing.streamKey} · ${formatTimestamp(playing.startedAt)}`
                : "Recording"}
            </DialogTitle>
            <DialogDescription>Playback from S3 (link expires).</DialogDescription>
          </DialogHeader>
          {playLoading || !playUrl ? (
            <Skeleton className="aspect-video w-full" />
          ) : (
            <video
              src={playUrl}
              controls
              autoPlay
              className="aspect-video w-full rounded bg-black"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleting(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete recording?</DialogTitle>
            <DialogDescription>
              This permanently deletes the recording
              {deleting
                ? ` from ${deleting.streamKey} (${formatTimestamp(deleting.startedAt)})`
                : ""}
              {" "}and its file in S3. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleteBusy}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteBusy}
              onClick={() => void confirmDelete()}
            >
              {deleteBusy ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
