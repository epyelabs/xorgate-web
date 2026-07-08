import type { ReactNode } from "react"
import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DataTable,
  formatBytes,
  formatDuration,
  type DataTableColumn,
  type DataTableExportConfig,
  type DataTablePaginationConfig,
  type DataTableSort,
} from "@/components/data-table"
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

// Effective duration in ms: prefer the stored duration, else derive it from the
// start/end timestamps (null while still recording).
function recordingDurationMs(rec: Recording): number | null {
  if (rec.durationMs != null) return rec.durationMs
  if (rec.endedAt) return new Date(rec.endedAt).getTime() - new Date(rec.startedAt).getTime()
  return null
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

// Human labels for recordings.end_reason (kvs-webrtc-lts §4.1) so a truncated /
// offline-ended recording is distinguishable from a clean stop.
const END_REASON_LABEL: Record<string, string> = {
  user_stop: "Stopped by user",
  device_offline: "Device went offline",
  stream_ended: "Stream ended",
  max_duration: "Max duration reached",
  task_lost: "Recorder task lost",
  error: "Error",
}

function StatusCell({ rec }: { rec: Recording }) {
  return (
    <div className="flex flex-col items-start gap-0.5">
      <Badge variant={STATUS_VARIANT[rec.status]} className="capitalize">
        {rec.status === "recording" && rec.captureStartedAt === null
          ? "Starting…"
          : rec.status}
      </Badge>
      {rec.endReason && (rec.status === "completed" || rec.status === "failed") ? (
        <span className="text-muted-foreground text-xs">
          {END_REASON_LABEL[rec.endReason] ?? rec.endReason}
        </span>
      ) : null}
    </div>
  )
}

// Recordings table built on the shared DataTable, with inline playback + delete.
// Used by the Media Recordings tab (full, sortable, paginated) and the device
// Overview (recent few — no sort/pagination). The parent owns fetching and the
// toolbar/pagination slots; this renders rows + dialogs and calls `onChanged`
// after a successful delete so the parent can refresh.
export function RecordingsTable({
  deviceId,
  recordings,
  onChanged,
  sort,
  onToggleSort,
  loading,
  isFiltered,
  emptyMessage,
  filteredEmptyMessage,
  toolbar,
  pagination,
  exportCsv,
  card = false,
}: {
  deviceId: string
  recordings: Recording[]
  onChanged?: () => void | Promise<void>
  sort?: DataTableSort
  onToggleSort?: (columnId: string) => void
  loading?: boolean
  isFiltered?: boolean
  emptyMessage?: string
  filteredEmptyMessage?: string
  toolbar?: ReactNode
  pagination?: DataTablePaginationConfig
  exportCsv?: DataTableExportConfig<Recording>
  // Render as a standalone framed card (Media page) vs. bare inside a host card
  // (device Overview). Defaults to bare.
  card?: boolean
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

  const columns: DataTableColumn<Recording>[] = [
    {
      id: "stream",
      header: "Stream",
      cellClassName: "font-mono",
      cell: (rec) => rec.streamKey,
      csvValue: (rec) => rec.streamKey,
    },
    {
      id: "startedAt",
      header: "Started",
      sortable: true,
      cell: (rec) => formatTimestamp(rec.startedAt),
      csvValue: (rec) => rec.startedAt,
    },
    {
      id: "durationMs",
      header: "Duration",
      numeric: true,
      sortable: true,
      cell: (rec) => formatDuration(recordingDurationMs(rec)),
      csvHeader: "Duration (ms)",
      csvValue: (rec) => recordingDurationMs(rec) ?? "",
    },
    {
      id: "sizeBytes",
      header: "Size",
      numeric: true,
      sortable: true,
      cell: (rec) => formatBytes(rec.sizeBytes),
      csvHeader: "Size (bytes)",
      csvValue: (rec) => rec.sizeBytes ?? "",
    },
    {
      id: "trigger",
      header: "Trigger",
      cellClassName: "capitalize",
      cell: (rec) => rec.trigger,
      csvValue: (rec) => rec.trigger,
    },
    {
      id: "status",
      header: "Status",
      cell: (rec) => <StatusCell rec={rec} />,
      csvValue: (rec) =>
        rec.endReason ? `${rec.status} (${rec.endReason})` : rec.status,
    },
    {
      id: "actions",
      header: "Actions",
      align: "right",
      cell: (rec) => (
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
      ),
    },
  ]

  return (
    <>
      <DataTable
        card={card}
        columns={columns}
        rows={recordings}
        getRowKey={(rec) => rec.id}
        sort={sort}
        onToggleSort={onToggleSort}
        loading={loading}
        isFiltered={isFiltered}
        empty={
          <p className="py-6 text-center text-sm text-muted-foreground">
            {emptyMessage ?? "No recordings yet."}
          </p>
        }
        filteredEmpty={
          <p className="py-6 text-center text-sm text-muted-foreground">
            {filteredEmptyMessage ?? "No recordings match this filter."}
          </p>
        }
        toolbar={toolbar}
        pagination={pagination}
        exportCsv={exportCsv}
      />

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
