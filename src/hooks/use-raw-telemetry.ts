import { useEffect, useRef, useState } from "react"
import mqtt from "mqtt"
import { presignIotWssUrl, useLiveCredentials } from "@xorgate/react"
import { attachLiveAccess, browserClientId } from "@/lib/live-plane"

const REGION = import.meta.env.VITE_AWS_REGION as string
const IOT_ENDPOINT = import.meta.env.VITE_IOT_ENDPOINT as string

export type RawTelemetryStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "closed"

export interface RawTelemetry {
  /** The last frame, exactly as it arrived (parsed JSON, nothing else done). */
  frame: unknown
  /** Which topic plane it arrived on — the unscoped one or the tenant one. */
  topic: string | null
  /** Browser-clock ms when it arrived. */
  receivedAt: number | null
  status: RawTelemetryStatus
  error: string | null
}

const EMPTY: RawTelemetry = {
  frame: null,
  topic: null,
  receivedAt: null,
  status: "idle",
  error: null,
}

const decoder = new TextDecoder()

/**
 * The device's telemetry frames, UNPARSED — the wire payload as published.
 *
 * `useLiveTelemetry` cannot serve this: it flattens `metrics.<group>.<field>`
 * into `group.field` keys, drops `v`/`deviceId`/`seq` entirely, and its
 * `latest`/`media`/`recording` accumulate across frames (a metric the device
 * stopped sending still sits there looking current). Nothing in its snapshot
 * answers "what was in the last message", which is the whole question the Raw
 * view exists to answer. So this opens its own subscription, over the same
 * Cognito-authed IoT WSS machinery the sim-progress hook uses.
 *
 * ⚠ Both telemetry planes are subscribed, matching what the SDK's credential
 * resolver does: a device publishes to the unscoped topic until the cloud tells
 * it its tenant, and to the tenant-scoped one after. Subscribing to only one is
 * how this silently shows nothing. The `+` wildcards stand in for the org and
 * workspace, which this consumer has no reason to know.
 *
 * QoS 0 and nothing is retained, so frames published before the subscription
 * completes are lost by design; at ~1 Hz the first one lands almost at once.
 */
export function useRawTelemetry(deviceId: string | null): RawTelemetry {
  const [state, setState] = useState<RawTelemetry>(EMPTY)
  // Credentials come from the provider's shared resolver — the same cache the
  // live telemetry and video hooks use, so this mints nothing of its own. A
  // refresh changes the object identity, which re-runs the effect below and
  // reconnects on a freshly presigned URL.
  const { credentials, refresh } = useLiveCredentials()
  const prevDeviceRef = useRef<string | null>(null)

  useEffect(() => {
    // A different device starts from nothing; a reconnect for the SAME device
    // keeps the last frame on screen rather than blanking the panel.
    const sameDevice = deviceId !== null && prevDeviceRef.current === deviceId
    prevDeviceRef.current = deviceId
    setState((s) =>
      sameDevice
        ? { ...s, status: "connecting", error: null }
        : { ...EMPTY, status: deviceId ? "connecting" : "idle" }
    )
    if (!deviceId) return

    if (!IOT_ENDPOINT) {
      setState((s) => ({
        ...s,
        status: "error",
        error: "Live telemetry is not configured (set VITE_IOT_ENDPOINT).",
      }))
      return
    }
    // Credentials still resolving (or the live plane is unavailable): stay in
    // "connecting"; the effect re-runs when they arrive.
    if (!credentials) return
    const creds = credentials

    const topics = [
      `xorgate/devices/${deviceId}/telemetry`,
      `xorgate/orgs/+/ws/+/devices/${deviceId}/telemetry`,
    ]

    let cancelled = false
    let client: mqtt.MqttClient | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let backoff = 1000

    function scheduleReconnect() {
      if (cancelled || reconnectTimer) return
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        void open()
      }, backoff)
      backoff = Math.min(backoff * 2, 15_000)
    }

    async function open() {
      if (cancelled) return
      try {
        setState((s) => ({ ...s, status: "connecting" }))
        // AWS IoT authorizes Cognito identities via an attached IoT policy;
        // idempotent, same dance as the live-telemetry pages. The identityId it
        // returns is what the client id must start with (see browserClientId).
        const { identityId } = await attachLiveAccess()
        if (cancelled) return
        const url = await presignIotWssUrl(IOT_ENDPOINT, REGION, creds)
        if (cancelled) return

        const next = mqtt.connect(url, {
          protocolVersion: 5,
          reconnectPeriod: 0, // manual reconnect (presigned URL is single-use-ish)
          clientId: browserClientId(identityId, "raw"),
          // mqtt.js drops the query string when it rebuilds the ws URL, which
          // would strip the SigV4 params; force the presigned URL through.
          transformWsUrl: () => url,
        })
        client = next

        next.on("connect", () => {
          if (cancelled) return
          backoff = 1000
          setState((s) => ({ ...s, status: "connected", error: null }))
          for (const t of topics) next.subscribe(t, { qos: 0 })
        })

        next.on("message", (topic, payload) => {
          if (cancelled) return
          let json: unknown
          try {
            json = JSON.parse(decoder.decode(payload as Uint8Array))
          } catch {
            return // not JSON: not our frame, and we have nothing to show
          }
          // Stored verbatim. No schema, no coercion, no field picking — an
          // unrecognised field is exactly what someone opens this view to find.
          setState((s) => ({
            ...s,
            frame: json,
            topic,
            receivedAt: Date.now(),
          }))
        })

        next.on("error", (err) => {
          if (cancelled) return
          setState((s) => ({
            ...s,
            status: "error",
            error: (err as Error)?.message ?? "mqtt error",
          }))
          // A refusal here is most often an expired credential: ask the shared
          // resolver for a fresh one (identity change re-runs this effect).
          void refresh()
          next.end(true)
        })

        next.on("close", () => {
          if (cancelled) return
          setState((s) => ({ ...s, status: "closed" }))
          scheduleReconnect()
        })
      } catch (err) {
        if (cancelled) return
        setState((s) => ({
          ...s,
          status: "error",
          error: (err as Error).message,
        }))
        scheduleReconnect()
      }
    }

    void open()

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      client?.end(true)
    }
  }, [deviceId, credentials, refresh])

  return state
}
