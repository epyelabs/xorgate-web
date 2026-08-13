import { useEffect, useState } from "react"
import mqtt from "mqtt"
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity"
import { getIdToken } from "@/lib/cognito"
import { attachIotPolicy } from "@/lib/api"
import { browserClientId, presignIotWssUrl } from "@/lib/iot-wss"
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
  // Browser-clock ms (Date.now()) when the last valid payload arrived, or null
  // if none has yet. Deliberately OUR clock, not the payload's `ts`: the device
  // can publish timestamps from an unsynced RTC (the 2026-07-24 rtc-vs-ntp
  // observation), so `ts` is unusable for "how fresh is this?". Consumers that
  // must fail open on a silent device use this — the live-stream gate ages the
  // block out after LIVE_BLOCK_STALE_MS.
  receivedAt: number | null
  status: ConnStatus
  error: string | null
}

const decoder = new TextDecoder()

/**
 * One shared MQTT-over-WSS connection per device (offline recording plan,
 * Phase 6.8). After Phase 5 the device layout (alert center) AND whichever tab
 * is active each consumed live telemetry — with a naive per-hook connection
 * that was 2+ concurrent WSS connections per device page, growing with every
 * new consumer. This module-level ref-counted store owns ONE connection +
 * buffer set per deviceId; `useIotTelemetry` acquires it on mount and releases
 * on unmount, and the connection closes when the last consumer leaves. The
 * hook's public API is unchanged.
 */
class TelemetryFeed {
  refs = 0

  private readonly deviceId: string
  private readonly subscribers = new Set<() => void>()

  private latest: Record<string, LatestReading> = {}
  private history: HistoryPoint[] = []
  private recording: DeviceRecordingStatus | null = null
  private media: DeviceMediaStatus | null = null
  private receivedAt: number | null = null
  private status: ConnStatus = "connecting"
  private error: string | null = null

  private stopped = false
  private dirty = false
  private client: mqtt.MqttClient | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private backoff = 1000

  constructor(deviceId: string) {
    this.deviceId = deviceId
  }

  snapshot(): UseIotTelemetry {
    return {
      latest: { ...this.latest },
      history: this.history.slice(),
      recording: this.recording,
      media: this.media,
      receivedAt: this.receivedAt,
      status: this.status,
      error: this.error,
    }
  }

  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb)
    return () => this.subscribers.delete(cb)
  }

  start(): void {
    if (!IOT_ENDPOINT || !IDENTITY_POOL_ID) {
      this.status = "error"
      this.error =
        "Live telemetry is not configured (set VITE_IOT_ENDPOINT + VITE_COGNITO_IDENTITY_POOL_ID)."
      return
    }
    this.flushTimer = setInterval(() => {
      if (!this.dirty) return
      this.dirty = false
      this.notify()
    }, FLUSH_MS)
    void this.open()
  }

  stop(): void {
    this.stopped = true
    if (this.flushTimer) clearInterval(this.flushTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.client?.end(true)
  }

  private notify(): void {
    for (const cb of this.subscribers) cb()
  }

  private setStatus(
    status: ConnStatus,
    error: string | null = this.error
  ): void {
    this.status = status
    this.error = error
    this.notify()
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.open()
    }, this.backoff)
    this.backoff = Math.min(this.backoff * 2, 30_000)
  }

  private async open(): Promise<void> {
    if (this.stopped) return
    const topic = `xorgate/devices/${this.deviceId}/telemetry`
    try {
      this.setStatus("connecting")
      // AWS IoT authorizes Cognito identities via an attached IoT policy, not
      // the IAM role — ensure it's attached before connecting (idempotent).
      // The response's identityId is also what the client id must start with:
      // the policy scopes iot:Connect to this identity (see browserClientId).
      const { identityId } = await attachIotPolicy()
      if (this.stopped) return
      const idToken = await getIdToken()
      if (!idToken) throw new Error("Not authenticated")
      const provider = fromCognitoIdentityPool({
        identityPoolId: IDENTITY_POOL_ID,
        logins: {
          [`cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`]: idToken,
        },
        clientConfig: { region: REGION },
      })
      const creds = await provider()
      if (this.stopped) return
      const url = await presignIotWssUrl(IOT_ENDPOINT, REGION, creds)
      if (this.stopped) return

      const next = mqtt.connect(url, {
        protocolVersion: 5,
        reconnectPeriod: 0, // we reconnect manually (presigned URL is single-use-ish)
        clientId: browserClientId(identityId, "web"),
        // mqtt.js rebuilds the ws URL from host/path only and DROPS the query
        // string — which would strip the SigV4 params and get us a 403 from IoT.
        // transformWsUrl forces the full presigned URL onto the WebSocket.
        transformWsUrl: () => url,
      })
      this.client = next

      next.on("connect", () => {
        if (this.stopped) return
        this.backoff = 1000
        this.setStatus("connected", null)
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
            this.latest[metric] = {
              value: leaf.value,
              unit: leaf.unit,
              ts: p.ts,
            }
            point[metric] = leaf.value
          }
        }
        this.history.push(point)
        if (this.history.length > HISTORY_CAP) {
          this.history.splice(0, this.history.length - HISTORY_CAP)
        }
        // Keep the last seen blocks (don't null out on a payload that omits
        // them — e.g. a validation .catch downgrade should not flicker the UI).
        if (p.recording) this.recording = p.recording
        if (p.media) this.media = p.media
        // Stamped on every accepted payload, including one that carries no
        // `recording` block — freshness is a property of the FEED, not of the
        // block, and a consumer aging out a stale verdict needs the former.
        this.receivedAt = Date.now()
        this.dirty = true
      })

      next.on("error", (err) => {
        if (this.stopped) return
        this.setStatus("error", (err as Error)?.message ?? "mqtt error")
        next.end(true)
      })

      next.on("close", () => {
        if (this.stopped) return
        this.setStatus("closed")
        this.scheduleReconnect()
      })

      // proactively cycle the connection before the presigned URL expires
      if (this.refreshTimer) clearTimeout(this.refreshTimer)
      this.refreshTimer = setTimeout(() => next.end(true), REFRESH_MS)
    } catch (err) {
      if (this.stopped) return
      this.setStatus("error", (err as Error).message)
      this.scheduleReconnect()
    }
  }
}

const feeds = new Map<string, TelemetryFeed>()

function acquireFeed(deviceId: string): TelemetryFeed {
  let feed = feeds.get(deviceId)
  if (!feed) {
    feed = new TelemetryFeed(deviceId)
    feeds.set(deviceId, feed)
    feed.start()
  }
  feed.refs++
  return feed
}

function releaseFeed(deviceId: string, feed: TelemetryFeed): void {
  feed.refs--
  if (feed.refs > 0) return
  // Last consumer gone — close the connection. The device layout keeps one
  // consumer mounted for the whole page visit, so tab switches never bounce
  // the socket; this only fires when leaving the device page entirely.
  feeds.delete(deviceId)
  feed.stop()
}

/**
 * Subscribe to a device's live telemetry over AWS IoT MQTT-over-WSS using
 * Cognito Identity-Pool credentials. Returns the latest value per metric and a
 * bounded ring buffer for live charts. All simultaneous consumers of the same
 * device share ONE underlying connection (see TelemetryFeed above).
 */
export function useIotTelemetry(deviceId: string): UseIotTelemetry {
  const [snap, setSnap] = useState<UseIotTelemetry>({
    latest: {},
    history: [],
    recording: null,
    media: null,
    receivedAt: null,
    status: "connecting",
    error: null,
  })

  useEffect(() => {
    const feed = acquireFeed(deviceId)
    /* eslint-disable react-hooks/set-state-in-effect */
    setSnap(feed.snapshot())
    /* eslint-enable react-hooks/set-state-in-effect */
    const unsubscribe = feed.subscribe(() => setSnap(feed.snapshot()))
    return () => {
      unsubscribe()
      releaseFeed(deviceId, feed)
    }
  }, [deviceId])

  return snap
}
