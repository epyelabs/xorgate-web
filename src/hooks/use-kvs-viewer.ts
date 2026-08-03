import { useEffect, useRef, useState } from "react"
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity"
import {
  KinesisVideoClient,
  GetSignalingChannelEndpointCommand,
} from "@aws-sdk/client-kinesis-video"
import {
  KinesisVideoSignalingClient,
  GetIceServerConfigCommand,
} from "@aws-sdk/client-kinesis-video-signaling"
import { Role, SignalingClient } from "amazon-kinesis-video-streams-webrtc"
import { getIdToken } from "@/lib/cognito"

const REGION = import.meta.env.VITE_AWS_REGION as string
const IDENTITY_POOL_ID = import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID as string
const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID as string

const REFRESH_MS = 50 * 60 * 1000 // re-open with fresh creds before the ~1 h expiry
// A peer connection can dip to "disconnected" on a brief ICE blip and recover on
// its own. But the KVS master frees its side of the session the instant ICE drops,
// so a "disconnected" here won't self-heal — give it a short grace for a genuine
// micro-blip, then force a fresh session rather than sit frozen on the last frame.
const DISCONNECT_GRACE_MS = 2500
// KVS does not queue SDP offers: if the master is offline when we send ours, no
// answer (and no pc/signaling event) ever arrives, so a session can sit in
// "waiting" forever. Deadline the whole connect attempt instead, and re-offer on
// a fresh session so we pick the master up shortly after it comes back.
const CONNECT_TIMEOUT_MS = 15_000
// On a flaky network the pre-signaling AWS calls (creds, endpoints, ICE config)
// can hang without rejecting, which would park open() forever with no retry
// scheduled. Deadline each step so a hang becomes a thrown error -> reconnect.
const SETUP_STEP_TIMEOUT_MS = 10_000
// How often the inbound-rtp stats are sampled for the player's spec label
// (resolution / fps / bitrate). Bitrate is a delta between samples, so this is
// also the averaging window: short enough to feel live, long enough that a
// single bursty interval doesn't make the number jitter.
const STATS_INTERVAL_MS = 2000

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

export type KvsStatus =
  | "connecting"
  | "waiting"
  | "connected"
  | "error"
  | "closed"

export interface KvsChannelInput {
  channelName: string
  channelArn: string
  region: string
}

/**
 * What the viewer is actually receiving right now, sampled from the peer
 * connection's inbound-rtp stats — not what the device was configured to send.
 * Any field can be missing: browsers differ on which inbound-rtp counters they
 * expose, and none are populated until frames are decoding.
 */
export interface KvsStreamStats {
  width: number | null
  height: number | null
  fps: number | null
  kbps: number | null
}

export interface UseKvsViewer {
  videoRef: React.RefObject<HTMLVideoElement | null>
  status: KvsStatus
  error: string | null
  stats: KvsStreamStats | null
}

/**
 * Run an AWS KVS WebRTC VIEWER for a single signaling channel and attach the
 * received MediaStream to the returned `videoRef`. Uses Cognito Identity-Pool
 * credentials (KVS authorizes via standard IAM/SigV4 — no IoT attach-policy).
 * Mirrors `use-iot-telemetry`: a `cancelled` flag, manual reconnect with
 * backoff, a proactive ~50 min creds cycle, and full teardown on unmount /
 * channel change. Pass `null` to stay idle (lets the grid obey Rules of Hooks).
 */
export function useKvsViewer(channel: KvsChannelInput | null): UseKvsViewer {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [status, setStatus] = useState<KvsStatus>("connecting")
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<KvsStreamStats | null>(null)

  useEffect(() => {
    let cancelled = false
    let pc: RTCPeerConnection | null = null
    let signaling: SignalingClient | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null
    let connectTimer: ReturnType<typeof setTimeout> | null = null
    let statsTimer: ReturnType<typeof setInterval> | null = null
    // Previous inbound-rtp sample, for the byte/frame deltas the label needs.
    let prevSample: {
      ts: number
      bytesReceived: number
      framesDecoded: number
    } | null = null
    let backoff = 1000
    // Generation counter: each open() invalidates prior in-flight runs, so a
    // stalled attempt resuming after an await can't cross-wire a newer session.
    let openSeq = 0

    if (!channel) return
    if (!IDENTITY_POOL_ID) {
      setStatus("error")
      setError(
        "Live video is not configured (set VITE_COGNITO_IDENTITY_POOL_ID)."
      )
      return
    }

    const region = channel.region || REGION

    async function freshCreds() {
      const idToken = await getIdToken()
      if (!idToken) throw new Error("Not authenticated")
      const provider = fromCognitoIdentityPool({
        identityPoolId: IDENTITY_POOL_ID,
        logins: {
          [`cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`]: idToken,
        },
        clientConfig: { region },
      })
      return provider()
    }

    // Sample inbound-rtp once and publish the player's spec label. Resolution
    // and fps come straight off the report; bitrate is derived from the
    // bytesReceived delta since the previous sample (the first sample after a
    // (re)connect therefore has no bitrate yet, which is why kbps is nullable).
    async function sampleStats() {
      if (cancelled || !pc) return
      let reports: RTCStatsReport
      try {
        reports = await pc.getStats()
      } catch {
        return // connection went away mid-sample
      }
      if (cancelled) return
      let inbound: RTCInboundRtpStreamStats | null = null
      reports.forEach((r) => {
        const s = r as RTCInboundRtpStreamStats
        if (s.type === "inbound-rtp" && s.kind === "video") inbound = s
      })
      if (!inbound) return
      // TS narrows a forEach-assigned local to `never`; the runtime shape is
      // whatever the browser put in the report, so read it through the type.
      const rtp = inbound as RTCInboundRtpStreamStats & {
        frameWidth?: number
        frameHeight?: number
        framesPerSecond?: number
        framesDecoded?: number
        bytesReceived?: number
      }
      const ts = rtp.timestamp
      const bytesReceived = rtp.bytesReceived ?? 0
      const framesDecoded = rtp.framesDecoded ?? 0

      let kbps: number | null = null
      // Not every browser reports framesPerSecond; fall back to the decoded-frame
      // delta over the sample window.
      let fps: number | null = rtp.framesPerSecond ?? null
      if (prevSample && ts > prevSample.ts) {
        const secs = (ts - prevSample.ts) / 1000
        const byteDelta = bytesReceived - prevSample.bytesReceived
        if (byteDelta >= 0) kbps = (byteDelta * 8) / secs / 1000
        if (fps === null) {
          const frameDelta = framesDecoded - prevSample.framesDecoded
          if (frameDelta >= 0) fps = frameDelta / secs
        }
      }
      prevSample = { ts, bytesReceived, framesDecoded }

      setStats({
        width: rtp.frameWidth ?? null,
        height: rtp.frameHeight ?? null,
        fps,
        kbps,
      })
    }

    // Close the peer connection + signaling client without touching the <video>
    // element, so a transient reconnect keeps the last frame on screen.
    function teardown() {
      if (statsTimer) {
        clearInterval(statsTimer)
        statsTimer = null
      }
      // The next session re-measures from scratch — carrying a delta across a
      // reconnect would report a bogus bitrate for the gap.
      prevSample = null
      setStats(null)
      if (disconnectTimer) {
        clearTimeout(disconnectTimer)
        disconnectTimer = null
      }
      if (connectTimer) {
        clearTimeout(connectTimer)
        connectTimer = null
      }
      if (signaling) {
        try {
          signaling.close()
        } catch {
          /* already closed */
        }
        signaling = null
      }
      if (pc) {
        try {
          pc.close()
        } catch {
          /* already closed */
        }
        pc = null
      }
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
      if (cancelled || !channel) return
      const seq = ++openSeq
      teardown() // drop any prior connection before re-opening
      try {
        setStatus("connecting")
        const creds = await withTimeout(
          freshCreds(),
          SETUP_STEP_TIMEOUT_MS,
          "credentials"
        )
        if (cancelled || seq !== openSeq) return

        // Backend already returns the channel ARN, so we skip DescribeSignalingChannel
        // and go straight to resolving the VIEWER endpoints.
        const kvClient = new KinesisVideoClient({ region, credentials: creds })
        const endpointRes = await withTimeout(
          kvClient.send(
            new GetSignalingChannelEndpointCommand({
              ChannelARN: channel.channelArn,
              SingleMasterChannelEndpointConfiguration: {
                Protocols: ["WSS", "HTTPS"],
                Role: Role.VIEWER,
              },
            })
          ),
          SETUP_STEP_TIMEOUT_MS,
          "signaling endpoints"
        )
        if (cancelled || seq !== openSeq) return
        const endpoints: Record<string, string> = {}
        for (const e of endpointRes.ResourceEndpointList ?? []) {
          if (e.Protocol && e.ResourceEndpoint) {
            endpoints[e.Protocol] = e.ResourceEndpoint
          }
        }
        if (!endpoints.WSS || !endpoints.HTTPS) {
          throw new Error("KVS endpoint list missing WSS/HTTPS")
        }

        // ICE servers: KVS STUN + the channel's TURN servers.
        const signalingChannelsClient = new KinesisVideoSignalingClient({
          region,
          endpoint: endpoints.HTTPS,
          credentials: creds,
        })
        const iceRes = await withTimeout(
          signalingChannelsClient.send(
            new GetIceServerConfigCommand({ ChannelARN: channel.channelArn })
          ),
          SETUP_STEP_TIMEOUT_MS,
          "ICE server config"
        )
        if (cancelled || seq !== openSeq) return
        const iceServers: RTCIceServer[] = [
          { urls: `stun:stun.kinesisvideo.${region}.amazonaws.com:443` },
        ]
        for (const s of iceRes.IceServerList ?? []) {
          if (s.Uris) {
            iceServers.push({
              urls: s.Uris,
              username: s.Username,
              credential: s.Password,
            })
          }
        }

        // Fresh clientId per connection: KVS rejects a duplicate VIEWER clientId,
        // and a stale id from a half-closed prior session can be refused.
        const clientId = crypto.randomUUID()
        signaling = new SignalingClient({
          channelARN: channel.channelArn,
          channelEndpoint: endpoints.WSS,
          role: Role.VIEWER,
          region,
          clientId,
          credentials: creds,
          systemClockOffset: kvClient.config.systemClockOffset,
        })

        pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: "all" })

        signaling.on("open", async () => {
          if (cancelled || !pc || !signaling) return
          try {
            pc.addTransceiver("video", { direction: "recvonly" })
            const offer = await pc.createOffer({ offerToReceiveVideo: true })
            await pc.setLocalDescription(offer)
            if (cancelled || !pc.localDescription) return
            signaling.sendSdpOffer(pc.localDescription)
            setStatus("waiting")
          } catch (err) {
            if (cancelled) return
            setStatus("error")
            setError((err as Error).message)
            // Without a reschedule this was a dead end (stuck on "error" until
            // a page refresh); recover like every other failure path.
            teardown()
            scheduleReconnect()
          }
        })

        signaling.on("sdpAnswer", async (answer) => {
          if (cancelled || !pc) return
          try {
            await pc.setRemoteDescription(answer)
          } catch {
            /* late/duplicate answer */
          }
        })

        signaling.on("iceCandidate", (candidate) => {
          if (cancelled || !pc) return
          pc.addIceCandidate(candidate).catch(() => {
            /* candidate arrived before remote description */
          })
        })

        signaling.on("close", () => {
          if (cancelled) return
          setStatus("closed")
          scheduleReconnect()
        })

        signaling.on("error", (err) => {
          if (cancelled) return
          setStatus("error")
          setError((err as Error)?.message ?? "signaling error")
          teardown()
          scheduleReconnect()
        })

        pc.addEventListener("icecandidate", ({ candidate }) => {
          if (cancelled || !signaling) return
          if (candidate) signaling.sendIceCandidate(candidate)
        })

        pc.addEventListener("track", (event) => {
          if (cancelled) return
          backoff = 1000
          // Always (re)attach the incoming stream. On a reconnect the old
          // srcObject still points at the previous (now-dead) stream, so only
          // attaching when empty would leave the <video> frozen on the last
          // frame. Assigning the same stream object twice is a harmless no-op.
          if (videoRef.current && videoRef.current.srcObject !== event.streams[0]) {
            videoRef.current.srcObject = event.streams[0]
          }
          setStatus("connected")
          setError(null)
        })

        pc.addEventListener("connectionstatechange", () => {
          if (cancelled || !pc) return
          const state = pc.connectionState
          if (state === "connected") {
            // (Re)connected — cancel any pending disconnect-grace reconnect
            // and the connect-attempt deadline.
            if (disconnectTimer) {
              clearTimeout(disconnectTimer)
              disconnectTimer = null
            }
            if (connectTimer) {
              clearTimeout(connectTimer)
              connectTimer = null
            }
          } else if (state === "failed") {
            // Hard failure — reconnect immediately.
            setStatus("closed")
            teardown()
            scheduleReconnect()
          } else if (state === "disconnected") {
            // Most common drop path (NAT/TURN/LTE blip). The master already tore
            // down its session, so the browser won't recover on its own; wait a
            // short grace for a real micro-blip, then force a fresh session.
            if (!disconnectTimer) {
              disconnectTimer = setTimeout(() => {
                disconnectTimer = null
                if (cancelled || !pc || pc.connectionState === "connected") return
                setStatus("closed")
                teardown()
                scheduleReconnect()
              }, DISCONNECT_GRACE_MS)
            }
          }
        })

        signaling.open()

        // Spec label sampler. Runs for the life of this session; before media
        // flows there simply is no inbound-rtp report and the sample no-ops.
        statsTimer = setInterval(() => void sampleStats(), STATS_INTERVAL_MS)

        // Connect-attempt deadline: if we aren't fully connected in time (offer
        // unanswered because the master is offline, ICE stalled, socket half-open),
        // tear down and retry with a fresh session + fresh offer.
        if (connectTimer) clearTimeout(connectTimer)
        connectTimer = setTimeout(() => {
          connectTimer = null
          if (cancelled || pc?.connectionState === "connected") return
          setStatus("closed")
          teardown()
          scheduleReconnect()
        }, CONNECT_TIMEOUT_MS)

        // Proactively cycle the connection with fresh creds before they expire.
        if (refreshTimer) clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => void open(), REFRESH_MS)
      } catch (err) {
        // A stale run erroring out (e.g. its step timeout firing after a newer
        // open() took over) must not disturb the current attempt.
        if (cancelled || seq !== openSeq) return
        setStatus("error")
        setError((err as Error).message)
        scheduleReconnect()
      }
    }

    void open()

    // Mobile browsers freeze background tabs: timers are suspended, network
    // events are dropped, and the peer connection is often dead by the time the
    // user returns. When the page becomes visible again (or the network comes
    // back), don't trust whatever state survived: if we aren't connected,
    // start a fresh attempt immediately instead of waiting out a stale backoff.
    const nudge = () => {
      if (cancelled) return
      if (document.visibilityState !== "visible") return
      if (pc && pc.connectionState === "connected") return
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      backoff = 1000
      void open()
    }
    window.addEventListener("online", nudge)
    window.addEventListener("pageshow", nudge)
    document.addEventListener("visibilitychange", nudge)

    return () => {
      cancelled = true
      window.removeEventListener("online", nudge)
      window.removeEventListener("pageshow", nudge)
      document.removeEventListener("visibilitychange", nudge)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (refreshTimer) clearTimeout(refreshTimer)
      teardown()
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [channel?.channelArn, channel?.region])

  return { videoRef, status, error, stats }
}
