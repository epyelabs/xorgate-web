import { useEffect, useRef, useState } from "react"
import { VideoOffIcon, WebcamIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { SourceBinding } from "./simulator-types"

// "Use webcam" for a video source: opens the laptop camera with getUserMedia, shows
// a live preview, and lets the user pick among connected cameras. Confirms into a
// `video-webcam` binding that records the chosen camera; the stream is re-acquired
// wherever it's previewed. Nothing is uploaded, and the camera is released on close.
export function SourceWebcamDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (binding: Extract<SourceBinding, { kind: "video-webcam" }>) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  // Acquire (or re-acquire) the camera whenever the dialog opens or the chosen
  // camera changes; enumerate cameras once permission has been granted.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    /* eslint-disable react-hooks/set-state-in-effect */
    setError(null)
    setReady(false)
    /* eslint-enable react-hooks/set-state-in-effect */
    ;(async () => {
      try {
        stopStream()
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        setReady(true)
        // Labels are only populated after permission is granted.
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) return
        setCameras(devices.filter((d) => d.kind === "videoinput"))
        // Lock onto the actually-granted camera so its label/id are stable.
        if (!deviceId) {
          const active = stream.getVideoTracks()[0]?.getSettings().deviceId
          if (active) setDeviceId(active)
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
      stopStream()
    }
  }, [open, deviceId])

  const currentCam = cameras.find((c) => c.deviceId === deviceId)
  const camName = currentCam?.label || "Webcam"
  const canConfirm = ready && !error

  const handleConfirm = () => {
    onConfirm({ kind: "video-webcam", name: camName, deviceId })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Use webcam</DialogTitle>
          <DialogDescription>
            Feed this video source from your laptop camera or a connected webcam.
            The preview stays on your machine.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="relative w-full overflow-hidden rounded-md border border-border bg-black">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="block aspect-video w-full object-cover"
            />
            {error ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/95 px-6 text-center">
                <VideoOffIcon className="size-6 text-muted-foreground" />
                <p className="text-xs text-destructive">
                  Couldn&apos;t access camera: {error}
                </p>
              </div>
            ) : null}
          </div>

          {cameras.length > 1 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Camera</span>
              <div className="flex flex-col gap-0.5 rounded-md border border-border p-1">
                {cameras.map((c, i) => {
                  const on = c.deviceId === deviceId
                  return (
                    <button
                      key={c.deviceId || i}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setDeviceId(c.deviceId)}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
                    >
                      <span
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                          on ? "border-primary" : "border-muted-foreground/40",
                        )}
                      >
                        {on ? (
                          <span className="size-2 rounded-full bg-primary" />
                        ) : null}
                      </span>
                      <WebcamIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                        {c.label || `Camera ${i + 1}`}
                      </span>
                    </button>
                  )
                })}
              </div>
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
            Use webcam
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
