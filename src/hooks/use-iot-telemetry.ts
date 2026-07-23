import { useEffect, useRef, useState } from "react"
import mqtt from "mqtt"
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity"
import { getIdToken } from "@/lib/cognito"
import { attachIotPolicy } from "@/lib/api"
import { presignIotWssUrl } from "@/lib/iot-wss"
import { telemetryPayloadSchema, type TelemetryPayload } from "@/lib/schemas"

const REGION = import.meta.env.VITE_AWS_REGION as string
const IDENTITY_POOL_ID = import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID as string
const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID as string
const IOT_ENDPOINT = import.meta.env.VITE_IOT_ENDPOINT as string

const HISTORY_CAP = 300 // ~5 min @ 1 Hz
const FLUSH_MS = 250 // coalesce 1 Hz × N-metric updates into ≤4 renders/s
const REFRESH_MS = 50 * 60 * 1000 // re-presign well before the 1 h URL/creds expiry

export type ConnStatus = "connecting" | "connected" | "error" | "closed"

export interface LatestReading {
  value: number
  unit?: string
  ts: number
}

export interface HistoryPoint {
  ts: number
  [metric: string]: number
}

// The payload's on-device recording status block (offline recording plan) —
// null until the first payload carrying it arrives.
export type DeviceRecordingStatus = NonNullable<TelemetryPayload["recording"]>
// The payload's media block (KVS + on-device video recording flags).
export type DeviceMediaStatus = NonNullable<TelemetryPayload["media"]>

export interface UseIotTelemetry {
  latest: Record<string, LatestReading>
  history: HistoryPoint[]
  // Latest recording/media status blocks from the live payload (1 Hz). The
  // recording block drives the backlog indicator and the settings page's
  // reported-state hint; media.recording.value = video recording active.
  recording: DeviceRecordingStatus | null
  media: DeviceMediaStatus | null
  status: ConnStatus
  error: string | null
}

const decoder = new TextDecoder()

/**
 * Subscribe to a device's live telemetry over AWS IoT MQTT-over-WSS using
 * Cognito Identity-Pool credentials. Returns the latest value per metric and a
 * bounded ring buffer for live charts. Handles creds/URL refresh, reconnect
 * with backoff, and cleanup on unmount / deviceId change.
 */
export function useIotTelemetry(deviceId: string): UseIotTelemetry {
  const [status, setStatus] = useState<ConnStatus>("connecting")
  const [error, setError] = useState<string | null>(null)
  const [latest, setLatest] = useState<Record<string, LatestReading>>({})
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [recording, setRecording] = useState<DeviceRecordingStatus | null>(null)
  const [media, setMedia] = useState<DeviceMediaStatus | null>(null)

  const latestRef = useRef<Record<string, LatestReading>>({})
  const historyRef = useRef<HistoryPoint[]>([])
  const recordingRef = useRef<DeviceRecordingStatus | null>(null)
  const mediaRef = useRef<DeviceMediaStatus | null>(null)
  const dirtyRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let client: mqtt.MqttClient | null = null
    let flushTimer: ReturnType<typeof setInterval> | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let backoff = 1000

    // reset buffers for the new device
    latestRef.current = {}
    historyRef.current = []
    recordingRef.current = null
    mediaRef.current = null
    setLatest({})
    setHistory([])
    setRecording(null)
    setMedia(null)

    if (!IOT_ENDPOINT || !IDENTITY_POOL_ID) {
      setStatus("error")
      setError(
        "Live telemetry is not configured (set VITE_IOT_ENDPOINT + VITE_COGNITO_IDENTITY_POOL_ID)."
      )
      return
    }

    const topic = `xorgate/devices/${deviceId}/telemetry`

    async function freshCreds() {
      const idToken = await getIdToken()
      if (!idToken) throw new Error("Not authenticated")
      const provider = fromCognitoIdentityPool({
        identityPoolId: IDENTITY_POOL_ID,
        logins: {
          [`cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`]: idToken,
        },
        clientConfig: { region: REGION },
      })
      return provider()
    }

    function scheduleReconnect() {
      if (cancelled || reconnectTimer) return
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        void open()
      }, backoff)
      backoff = Math.min(backoff * 2, 30_000)
    }

    async function open() {
      if (cancelled) return
      try {
        setStatus("connecting")
        // AWS IoT authorizes Cognito identities via an attached IoT policy, not
        // the IAM role — ensure it's attached before connecting (idempotent).
        await attachIotPolicy()
        if (cancelled) return
        const creds = await freshCreds()
        if (cancelled) return
        const url = await presignIotWssUrl(IOT_ENDPOINT, REGION, creds)
        if (cancelled) return

        const next = mqtt.connect(url, {
          protocolVersion: 5,
          reconnectPeriod: 0, // we reconnect manually (presigned URL is single-use-ish)
          clientId: `web-${crypto.randomUUID()}`,
          // mqtt.js rebuilds the ws URL from host/path only and DROPS the query
          // string — which would strip the SigV4 params and get us a 403 from IoT.
          // transformWsUrl forces the full presigned URL onto the WebSocket.
          transformWsUrl: () => url,
        })
        client = next

        next.on("connect", () => {
          if (cancelled) return
          backoff = 1000
          setStatus("connected")
          setError(null)
          next.subscribe(topic, { qos: 0 })
        })

        next.on("message", (_t, payload) => {
          let json: unknown
          try {
            json = JSON.parse(decoder.decode(payload as Uint8Array))
          } catch {
            return
          }
          const parsed = telemetryPayloadSchema.safeParse(json)
          if (!parsed.success) return
          const p = parsed.data
          const point: HistoryPoint = { ts: p.ts }
          for (const [group, fields] of Object.entries(p.metrics)) {
            for (const [field, leaf] of Object.entries(fields)) {
              const metric = `${group}.${field}`
              latestRef.current[metric] = {
                value: leaf.value,
                unit: leaf.unit,
                ts: p.ts,
              }
              point[metric] = leaf.value
            }
          }
          historyRef.current.push(point)
          if (historyRef.current.length > HISTORY_CAP) {
            historyRef.current.splice(0, historyRef.current.length - HISTORY_CAP)
          }
          // Keep the last seen blocks (don't null out on a payload that omits
          // them — e.g. a validation .catch downgrade should not flicker the UI).
          if (p.recording) recordingRef.current = p.recording
          if (p.media) mediaRef.current = p.media
          dirtyRef.current = true
        })

        next.on("error", (err) => {
          if (cancelled) return
          setStatus("error")
          setError((err as Error)?.message ?? "mqtt error")
          next.end(true)
        })

        next.on("close", () => {
          if (cancelled) return
          setStatus("closed")
          scheduleReconnect()
        })

        // proactively cycle the connection before the presigned URL expires
        if (refreshTimer) clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => next.end(true), REFRESH_MS)
      } catch (err) {
        if (cancelled) return
        setStatus("error")
        setError((err as Error).message)
        scheduleReconnect()
      }
    }

    flushTimer = setInterval(() => {
      if (!dirtyRef.current) return
      dirtyRef.current = false
      setLatest({ ...latestRef.current })
      setHistory(historyRef.current.slice())
      setRecording(recordingRef.current)
      setMedia(mediaRef.current)
    }, FLUSH_MS)

    void open()

    return () => {
      cancelled = true
      if (flushTimer) clearInterval(flushTimer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (refreshTimer) clearTimeout(refreshTimer)
      client?.end(true)
    }
  }, [deviceId])

  return { latest, history, recording, media, status, error }
}
