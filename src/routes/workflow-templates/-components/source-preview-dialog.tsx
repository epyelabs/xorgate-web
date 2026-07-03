import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { getRecordingPlaybackUrl } from "@/lib/api"
import type { SourceBinding } from "./simulator-types"
import { bindingLabel } from "./simulator-types"

// Plays the video behind a bound source. Uploaded files play straight from their
// in-browser object URL; device recordings fetch a fresh presigned S3 URL on open
// (mirrors the recordings-table playback dialog). Only opened for video bindings.
export function SourcePreviewDialog({
  binding,
  open,
  onOpenChange,
}: {
  binding: Extract<
    SourceBinding,
    { kind: "video-file" | "video-recording" }
  > | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // Uploaded files play straight from their object URL (known synchronously);
  // only device recordings need an async presigned URL, tracked here.
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !binding || binding.kind !== "video-recording") return
    let cancelled = false
    /* eslint-disable react-hooks/set-state-in-effect */
    setRemoteUrl(null)
    setError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    ;(async () => {
      try {
        const { url: playUrl } = await getRecordingPlaybackUrl(
          binding.deviceId,
          binding.recording.id,
        )
        if (!cancelled) setRemoteUrl(playUrl)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, binding])

  const url = binding?.kind === "video-file" ? binding.url : remoteUrl

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">
            {binding ? bindingLabel(binding) : "Preview"}
          </DialogTitle>
          <DialogDescription>
            {binding?.kind === "video-recording"
              ? "Playback from S3 (link expires)."
              : "Local preview — this file is not uploaded."}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="rounded-md border border-dashed border-destructive/50 px-3 py-6 text-center text-xs text-destructive">
            Couldn&apos;t load video: {error}
          </p>
        ) : !url ? (
          <Skeleton className="aspect-video w-full" />
        ) : (
          <video
            src={url}
            controls
            autoPlay
            className="aspect-video w-full rounded bg-black"
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
