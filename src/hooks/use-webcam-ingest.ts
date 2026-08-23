import { useCallback, useEffect, useRef, useState } from "react"
import mqtt from "mqtt"
import { presignIotWssUrl, useLiveCredentials } from "@xorgate/react"
import { attachLiveAccess, browserClientId } from "@/lib/live-plane"

const REGION = import.meta.env.VITE_AWS_REGION as string
const IOT_ENDPOINT = import.meta.env.VITE_IOT_ENDPOINT as string

// The engine-side guardrails mirrored client-side: <= 5 fps, <= 480p JPEG,
// comfortably under IoT's 128 KB message cap after the JSON+base64 envelope.
const CAPTURE_FPS = 5
const CAPTURE_MAX_HEIGHT = 480
const CAPTURE_MAX_WIDTH = 854
const JPEG_QUALITY = 0.6
const MAX_FRAME_BASE64_BYTES = 110_000

export type WebcamIngestStatus =
  | "idle"
  | "starting"
  | "publishing"
  | "stopped"
  | "error"

export interface WebcamIngest {
  status: WebcamIngestStatus
  error: string | null
  framesSent: number
  /** The live camera stream, for the local preview + overlay. */
  stream: MediaStream | null
  /** Publishes the end message and tears the capture down (user stop). */
  stop: () => void
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("read failed"))
    reader.onload = () => {
      // data:image/jpeg;base64,<payload>
      const s = String(reader.result)
      resolve(s.slice(s.indexOf(",") + 1))
    }
    reader.readAsDataURL(blob)
  })
}

/**
 * The M5 webcam capture publisher (architecture §5): while `active`, samples
 * the local camera at <= 5 fps / <= 480p, JPEG-encodes each frame, and
 * publishes `{ seq, ts, jpegBase64 }` to `<topicPrefix>/ingest/<nodeId>` over
 * the same Cognito-authed MQTT-over-WSS machinery as the progress
 * subscription. On stop (user action or teardown) it publishes `{ end: true }`
 * so the engine drains cleanly and the run succeeds.
 *
 * Delivery is QoS 0: frames published while the engine container is still
 * booting are lost by design (live semantics); the warm simulator session
 * makes that window near-zero on reruns.
 */
export function useWebcamIngest(args: {
  active: boolean
  topicPrefix: string | null
  nodeId: string | null
  cameraDeviceId?: string
}): WebcamIngest {
  const { active, topicPrefix, nodeId, cameraDeviceId } = args
  // Provider-shared live credentials; nothing is minted locally.
  const { credentials } = useLiveCredentials()
  const [status, setStatus] = useState<WebcamIngestStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [framesSent, setFramesSent] = useState(0)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!active || !topicPrefix || !nodeId) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setStatus("idle")
      setError(null)
      setFramesSent(0)
      setStream(null)
      /* eslint-enable react-hooks/set-state-in-effect */
      return
    }

    let cancelled = false
    let client: mqtt.MqttClient | null = null
    let media: MediaStream | null = null
    let captureTimer: ReturnType<typeof setInterval> | null = null
    let ended = false
    const topic = `${topicPrefix}/ingest/${nodeId}`

    const teardown = (publishEnd: boolean) => {
      if (captureTimer) clearInterval(captureTimer)
      captureTimer = null
      const c = client
      client = null
      if (c) {
        if (publishEnd && c.connected && !ended) {
          ended = true
          // Flush the end message before closing: a force-close (end(true))
          // right after publish destroys the socket before the QoS 0 packet
          // is written, so the engine never sees the end and only drains via
          // its 60 s frame-idle timeout. Graceful end after the publish
          // callback, with a force-close fallback if the socket is wedged.
          const forceClose = setTimeout(() => c.end(true), 2000)
          c.publish(topic, JSON.stringify({ end: true }), { qos: 0 }, () => {
            clearTimeout(forceClose)
            c.end(false)
          })
        } else {
          c.end(true)
        }
      }
      media?.getTracks().forEach((t) => t.stop())
      media = null
    }

    stopRef.current = () => {
      teardown(true)
      setStatus("stopped")
      setStream(null)
    }

    ;(async () => {
      try {
        setStatus("starting")
        setError(null)
        setFramesSent(0)
        if (!IOT_ENDPOINT) {
          throw new Error("Live ingest is not configured (set VITE_IOT_ENDPOINT)")
        }
        if (!credentials) {
          // Resolver still minting; the effect re-runs when they arrive.
          return
        }

        media = await navigator.mediaDevices.getUserMedia({
          video: cameraDeviceId
            ? { deviceId: { exact: cameraDeviceId } }
            : { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) return
        setStream(media)

        // Same identity/policy/presign dance as use-sim-progress; the
        // identityId is what the client id must start with (browserClientId).
        const { identityId } = await attachLiveAccess()
        if (cancelled) return
        const url = await presignIotWssUrl(IOT_ENDPOINT, REGION, credentials)
        if (cancelled) return

        client = mqtt.connect(url, {
          protocolVersion: 5,
          reconnectPeriod: 0,
          clientId: browserClientId(identityId, "ingest"),
          transformWsUrl: () => url,
        })
        client.on("error", (err) => {
          if (cancelled) return
          setError((err as Error)?.message ?? "mqtt error")
          setStatus("error")
          teardown(false)
        })

        // Offscreen <video> + canvas capture loop.
        const video = document.createElement("video")
        video.muted = true
        video.playsInline = true
        video.srcObject = media
        await video.play()
        if (cancelled) return

        const canvas = document.createElement("canvas")
        const ctx2d = canvas.getContext("2d")
        if (!ctx2d) throw new Error("Canvas 2D is unavailable")
        let seq = 0

        captureTimer = setInterval(() => {
          if (!client?.connected || video.videoWidth === 0) return
          const scale = Math.min(
            1,
            CAPTURE_MAX_HEIGHT / video.videoHeight,
            CAPTURE_MAX_WIDTH / video.videoWidth,
          )
          canvas.width = Math.round(video.videoWidth * scale)
          canvas.height = Math.round(video.videoHeight * scale)
          ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height)
          const ts = Date.now()
          const frameSeq = seq++
          canvas.toBlob(
            (blob) => {
              if (!blob || !client?.connected) return
              void blobToBase64(blob).then((jpegBase64) => {
                if (!client?.connected || jpegBase64.length > MAX_FRAME_BASE64_BYTES)
                  return
                client.publish(
                  topic,
                  JSON.stringify({ seq: frameSeq, ts, jpegBase64 }),
                  { qos: 0 },
                )
                setFramesSent((n) => n + 1)
              })
            },
            "image/jpeg",
            JPEG_QUALITY,
          )
        }, 1000 / CAPTURE_FPS)

        setStatus("publishing")
      } catch (err) {
        if (cancelled) return
        setError((err as Error).message)
        setStatus("error")
        teardown(false)
        setStream(null)
      }
    })()

    return () => {
      cancelled = true
      teardown(true)
      stopRef.current = null
    }
  }, [active, topicPrefix, nodeId, cameraDeviceId, credentials])

  const stop = useCallback(() => stopRef.current?.(), [])
  return { status, error, framesSent, stream, stop }
}
