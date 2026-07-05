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

export interface UseKvsViewer {
  videoRef: React.RefObject<HTMLVideoElement | null>
  status: KvsStatus
  error: string | null
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

  useEffect(() => {
    let cancelled = false
    let pc: RTCPeerConnection | null = null
    let signaling: SignalingClient | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null
    let backoff = 1000

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

    // Close the peer connection + signaling client without touching the <video>
    // element, so a transient reconnect keeps the last frame on screen.
    function teardown() {
      if (disconnectTimer) {
        clearTimeout(disconnectTimer)
        disconnectTimer = null
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
      teardown() // drop any prior connection before re-opening
      try {
        setStatus("connecting")
        const creds = await freshCreds()
        if (cancelled) return

        // Backend already returns the channel ARN, so we skip DescribeSignalingChannel
        // and go straight to resolving the VIEWER endpoints.
        const kvClient = new KinesisVideoClient({ region, credentials: creds })
        const endpointRes = await kvClient.send(
          new GetSignalingChannelEndpointCommand({
            ChannelARN: channel.channelArn,
            SingleMasterChannelEndpointConfiguration: {
              Protocols: ["WSS", "HTTPS"],
              Role: Role.VIEWER,
            },
          })
        )
        if (cancelled) return
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
        const iceRes = await signalingChannelsClient.send(
          new GetIceServerConfigCommand({ ChannelARN: channel.channelArn })
        )
        if (cancelled) return
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
            // (Re)connected — cancel any pending disconnect-grace reconnect.
            if (disconnectTimer) {
              clearTimeout(disconnectTimer)
              disconnectTimer = null
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

        // Proactively cycle the connection with fresh creds before they expire.
        if (refreshTimer) clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => void open(), REFRESH_MS)
      } catch (err) {
        if (cancelled) return
        setStatus("error")
        setError((err as Error).message)
        scheduleReconnect()
      }
    }

    void open()

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (refreshTimer) clearTimeout(refreshTimer)
      teardown()
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [channel?.channelArn, channel?.region])

  return { videoRef, status, error }
}
