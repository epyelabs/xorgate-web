import { useEffect, useRef, useState } from "react"
import mqtt from "mqtt"
import { presignIotWssUrl, useLiveCredentials } from "@xorgate/react"
import { attachLiveAccess, browserClientId } from "@/lib/live-plane"
import {
  simEventPayloadSchema,
  simPreviewPayloadSchema,
  simRecordPayloadSchema,
  simStatusPayloadSchema,
  simStepPayloadSchema,
  type SimEvent,
  type SimPreviewPayload,
  type SimRecordPayload,
  type SimStatusPayload,
  type SimStep,
} from "@/lib/workflow-sim-schemas"

const REGION = import.meta.env.VITE_AWS_REGION as string
const IOT_ENDPOINT = import.meta.env.VITE_IOT_ENDPOINT as string

const FLUSH_MS = 200 // coalesce bursts of step/record messages into ≤5 renders/s
const RECORDS_CAP_PER_NODE = 400 // live-view ring only; the full set comes from S3

export type SimConnStatus = "idle" | "connecting" | "connected" | "error" | "closed"

export interface SimProgress {
  connection: SimConnStatus
  connectionError: string | null
  // Latest terminal-or-running status seen on <prefix>/status (may be missed
  // entirely on fast Lambda runs — the run detail poll is authoritative).
  status: SimStatusPayload | null
  // Steps by seq, in completion order (deduped on redelivery).
  steps: SimStep[]
  events: SimEvent[]
  // Latest preview frame per nodeId (<prefix>/preview/<nodeId>).
  previews: Record<string, SimPreviewPayload>
  // Bounded ring of json-channel records per nodeId (<prefix>/records/<nodeId>).
  // Throttled server-side to live pace; batch overlays must use the post-run
  // Data Capture artifact instead (frozen wire-contract note).
  records: Record<string, SimRecordPayload[]>
}

const EMPTY: SimProgress = {
  connection: "idle",
  connectionError: null,
  status: null,
  steps: [],
  events: [],
  previews: {},
  records: {},
}

const decoder = new TextDecoder()

/**
 * Subscribes to a simulation run's live-progress topics
 * (wf/sim/<orgId>/<runId>/#) over the existing Cognito-authed IoT WSS
 * machinery. Pass the `topicPrefix` from the simulations POST response; pass
 * null to disconnect (state resets when the prefix changes).
 *
 * Delivery is QoS 0 best-effort AND the subscription races the engine start,
 * so early messages (a sub-second Lambda run's entire lifecycle) can be
 * missed; callers must poll the run row for terminal status and treat these
 * topics purely as the live view.
 */
export function useSimProgress(topicPrefix: string | null): SimProgress {
  const [state, setState] = useState<SimProgress>(EMPTY)

  // Credentials come from the provider's shared resolver (same cache the live
  // telemetry/video hooks use), so this hook mints nothing of its own. A
  // refresh changes the object identity, which re-runs the effect below and
  // reconnects on a freshly presigned URL.
  const { credentials, refresh } = useLiveCredentials()

  // Buffers mutated on message, flushed to state on a timer (like the live
  // telemetry feed) so 10/s record bursts don't render-thrash.
  const bufRef = useRef<SimProgress>(EMPTY)
  const dirtyRef = useRef(false)

  useEffect(() => {
    bufRef.current = {
      ...EMPTY,
      connection: topicPrefix ? "connecting" : "idle",
    }
    setState(bufRef.current)
    if (!topicPrefix) return

    let cancelled = false
    let client: mqtt.MqttClient | null = null
    let flushTimer: ReturnType<typeof setInterval> | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let backoff = 1000

    const patch = (update: Partial<SimProgress>) => {
      bufRef.current = { ...bufRef.current, ...update }
      dirtyRef.current = true
    }

    if (!IOT_ENDPOINT) {
      patch({
        connection: "error",
        connectionError: "Live progress is not configured (set VITE_IOT_ENDPOINT).",
      })
      setState(bufRef.current)
      return
    }
    // Credentials still resolving (or the live plane is unavailable): stay in
    // "connecting"; the effect re-runs when they arrive.
    if (!credentials) return
    const creds = credentials

    function scheduleReconnect() {
      if (cancelled || reconnectTimer) return
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        void open()
      }, backoff)
      backoff = Math.min(backoff * 2, 15_000)
    }

    function onMessage(topic: string, payload: Uint8Array) {
      if (!topicPrefix || !topic.startsWith(`${topicPrefix}/`)) return
      const suffix = topic.slice(topicPrefix.length + 1)
      let json: unknown
      try {
        json = JSON.parse(decoder.decode(payload))
      } catch {
        return
      }

      if (suffix === "status") {
        const parsed = simStatusPayloadSchema.safeParse(json)
        if (parsed.success) patch({ status: parsed.data })
        return
      }
      if (suffix === "steps") {
        const parsed = simStepPayloadSchema.safeParse(json)
        if (!parsed.success) return
        const step = parsed.data.step
        const steps = bufRef.current.steps.some((s) => s.seq === step.seq)
          ? bufRef.current.steps
          : [...bufRef.current.steps, step]
        patch({ steps })
        return
      }
      if (suffix === "events") {
        const parsed = simEventPayloadSchema.safeParse(json)
        if (parsed.success) patch({ events: [...bufRef.current.events, parsed.data.event] })
        return
      }
      if (suffix.startsWith("preview/")) {
        const parsed = simPreviewPayloadSchema.safeParse(json)
        if (!parsed.success) return
        patch({
          previews: { ...bufRef.current.previews, [parsed.data.nodeId]: parsed.data },
        })
        return
      }
      if (suffix.startsWith("records/")) {
        const parsed = simRecordPayloadSchema.safeParse(json)
        if (!parsed.success) return
        const nodeId = parsed.data.nodeId
        const ring = [...(bufRef.current.records[nodeId] ?? []), parsed.data]
        if (ring.length > RECORDS_CAP_PER_NODE) ring.splice(0, ring.length - RECORDS_CAP_PER_NODE)
        patch({ records: { ...bufRef.current.records, [nodeId]: ring } })
      }
    }

    async function open() {
      if (cancelled) return
      try {
        patch({ connection: "connecting" })
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
          clientId: browserClientId(identityId, "sim"),
          // mqtt.js drops the query string when it rebuilds the ws URL, which
          // would strip the SigV4 params; force the presigned URL through.
          transformWsUrl: () => url,
        })
        client = next

        next.on("connect", () => {
          if (cancelled) return
          backoff = 1000
          patch({ connection: "connected", connectionError: null })
          next.subscribe(`${topicPrefix}/#`, { qos: 0 })
        })

        next.on("message", (topic, payload) => {
          if (!cancelled) onMessage(topic, payload as Uint8Array)
        })

        next.on("error", (err) => {
          if (cancelled) return
          patch({
            connection: "error",
            connectionError: (err as Error)?.message ?? "mqtt error",
          })
          // A refusal here is most often an expired credential: ask the shared
          // resolver for a fresh one (identity change re-runs this effect).
          void refresh()
          next.end(true)
        })

        next.on("close", () => {
          if (cancelled) return
          patch({ connection: "closed" })
          scheduleReconnect()
        })
      } catch (err) {
        if (cancelled) return
        patch({ connection: "error", connectionError: (err as Error).message })
        scheduleReconnect()
      }
    }

    flushTimer = setInterval(() => {
      if (!dirtyRef.current) return
      dirtyRef.current = false
      setState(bufRef.current)
    }, FLUSH_MS)

    void open()

    return () => {
      cancelled = true
      if (flushTimer) clearInterval(flushTimer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      client?.end(true)
    }
  }, [topicPrefix, credentials, refresh])

  return state
}
