import { useEffect, useRef, useState } from "react"
import { RadioIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { xg, xgMessage } from "@/lib/xorgate"
import type { VideoBinding } from "./simulator-types"
import { bindingLabel } from "./simulator-types"

const DESCRIPTION: Record<VideoBinding["kind"], string> = {
  "video-file": "Local preview — this file is not uploaded.",
  "video-session": "First segment of the session (link expires).",
  "video-live": "Live device stream (simulated preview).",
  "video-webcam": "Live camera preview — nothing is uploaded.",
}

// Plays the video behind a bound source. Uploaded files play straight from their
// in-browser object URL; an on-device session previews its FIRST segment via a
// fresh presigned S3 URL (a session is N standalone ~60 s files, so there is no
// single object to play — the Replay tab is where a whole session is scrubbed);
// the webcam re-acquires the local camera; a live device stream shows a simulated
// live panel. Only opened for video bindings.
export function SourcePreviewDialog({
  binding,
  open,
  onOpenChange,
}: {
  binding: VideoBinding | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // Uploaded files play straight from their object URL (known synchronously);
  // only session segments need an async presigned URL, tracked here.
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const webcamRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!open || !binding || binding.kind !== "video-session") return
    let cancelled = false
    /* eslint-disable react-hooks/set-state-in-effect */
    setRemoteUrl(null)
    setError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    ;(async () => {
      try {
        // Chronologically first segment — NOT seq 0, which retention may have
        // evicted (and seq ordering is unreliable for reopened sessions).
        const { segments } = await xg().media.segments(
          binding.deviceId,
          binding.session.id,
        )
        const first = [...segments].sort((a, b) =>
          a.startTs < b.startTs ? -1 : 1,
        )[0]
        if (!first) throw new Error("This session has no stored segments")
        const { url: playUrl } = await xg().media.segmentPlaybackUrl(
          binding.deviceId,
          binding.session.id,
          first.seq,
        )
        if (!cancelled) setRemoteUrl(playUrl)
      } catch (err) {
        if (!cancelled) setError(xgMessage(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, binding])

  // Webcam: acquire the live camera stream while the dialog is open, releasing it
  // (and stopping the camera light) on close.
  useEffect(() => {
    if (!open || !binding || binding.kind !== "video-webcam") return
    let cancelled = false
    let stream: MediaStream | null = null
    /* eslint-disable react-hooks/set-state-in-effect */
    setError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: binding.deviceId
            ? { deviceId: { exact: binding.deviceId } }
            : true,
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        if (webcamRef.current) webcamRef.current.srcObject = stream
      } catch (err) {
        if (!cancelled) setError(xgMessage(err))
      }
    })()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
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
            {binding ? DESCRIPTION[binding.kind] : null}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="rounded-md border border-dashed border-destructive/50 px-3 py-6 text-center text-xs text-destructive">
            Couldn&apos;t load video: {error}
          </p>
        ) : binding?.kind === "video-webcam" ? (
          <video
            ref={webcamRef}
            autoPlay
            muted
            playsInline
            className="aspect-video w-full rounded bg-black object-cover"
          />
        ) : binding?.kind === "video-live" ? (
          <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded bg-gradient-to-br from-zinc-800 to-zinc-900">
            <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
              <span className="size-2 animate-pulse rounded-full bg-red-500" />
              LIVE
            </span>
            <div className="flex flex-col items-center gap-2 text-zinc-400">
              <RadioIcon className="size-8" />
              <span className="text-xs">{bindingLabel(binding)}</span>
            </div>
          </div>
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
