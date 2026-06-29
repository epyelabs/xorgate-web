import { useCallback, useEffect, useState } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
  getDeviceRecordings,
  getRecordingPlaybackUrl,
  type Recording,
  type RecordingStatus,
} from "@/lib/api"
import { getDeviceRecordingsResponseSchema } from "@/lib/schemas"
import { useAuthStore } from "@/store/auth"

export const Route = createFileRoute("/devices/$id/media")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DeviceMediaPage,
})

const POLL_MS = 5000

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

function DeviceMediaPage() {
  const { id } = Route.useParams()
  const [recordings, setRecordings] = useState<Recording[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [playing, setPlaying] = useState<Recording | null>(null)
  const [playUrl, setPlayUrl] = useState<string | null>(null)
  const [playLoading, setPlayLoading] = useState(false)

  const [deleting, setDeleting] = useState<Recording | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const raw = await getDeviceRecordings(id)
      const parsed = getDeviceRecordingsResponseSchema.safeParse(raw)
      if (!parsed.success) throw new Error("Unexpected recordings response")
      setRecordings(parsed.data.recordings)
      setLoadError(null)
    } catch (err) {
      setLoadError((err as Error).message)
    }
  }, [id])

  // Poll while mounted so statuses/sizes stay current (e.g. recording -> completed).
  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  async function openPlayer(rec: Recording) {
    setPlaying(rec)
    setPlayUrl(null)
    setPlayLoading(true)
    try {
      const { url } = await getRecordingPlaybackUrl(id, rec.id)
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
      await deleteRecording(id, deleting.id)
      toast.success("Recording deleted")
      setDeleting(null)
      await refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Recordings</CardTitle>
          <CardDescription>
            Recorded video clips for this device. Start a recording from the
            Active Streams tab, or enable auto-record in Settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recordings === null ? (
            loadError ? (
              <p className="text-sm text-destructive">{loadError}</p>
            ) : (
              <Skeleton className="h-32 w-full" />
            )
          ) : recordings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recordings yet.
            </p>
          ) : (
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
                        {rec.status}
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
          )}
        </CardContent>
      </Card>

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
              {playing ? `${playing.streamKey} · ${formatTimestamp(playing.startedAt)}` : "Recording"}
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
              {deleting ? ` from ${deleting.streamKey} (${formatTimestamp(deleting.startedAt)})` : ""}
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
    </div>
  )
}
