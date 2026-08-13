import { Sha256 } from "@aws-crypto/sha256-js"

export interface AwsCreds {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  expiration?: Date
}

// --- SigV4 primitives (HMAC via @aws-crypto/sha256-js, which keys the hash when
// constructed with a secret — exactly how the AWS SDK signs). ---
async function sha256Hex(data: string): Promise<string> {
  const h = new Sha256()
  h.update(data)
  return toHex(await h.digest())
}

async function hmac(key: Uint8Array | string, data: string): Promise<Uint8Array> {
  const h = new Sha256(key)
  h.update(data)
  return h.digest()
}

function toHex(bytes: Uint8Array): string {
  let out = ""
  for (const b of bytes) out += b.toString(16).padStart(2, "0")
  return out
}

/**
 * MQTT client id for a browser connection.
 *
 * The browser IoT policy scopes `iot:Connect` to
 * `client/${cognito-identity.amazonaws.com:sub}*`, so the id MUST begin with the
 * caller's own Cognito identity id or the broker refuses the CONNECT. Before
 * that fix the policy allowed `client/*`, and since deviceId = thing name = MQTT
 * client id, any authenticated user could connect as a device and knock it off
 * the broker (MQTT displaces the older session on a client-id collision).
 *
 * `identityId` comes from `POST /iot/attach-policy`, which every connect path
 * already awaits. The random suffix matters: two tabs of the same user resolve
 * to the SAME identity id, and a single tab already opens several connections
 * (telemetry feed, workflow-run progress, webcam ingest), so a bare identity id
 * would make our own connections displace each other.
 *
 * `role` is a short human-readable hint ("web", "sim", "ingest") that survives
 * into CloudWatch and the broker's client-id, purely for debugging.
 */
export function browserClientId(identityId: string, role: string): string {
  return `${identityId}-${role}-${crypto.randomUUID()}`
}

/**
 * Build a SigV4 query-presigned WSS URL for AWS IoT Core's MQTT-over-WebSocket
 * endpoint, following the IoT-specific signing rule:
 *
 *   1. Sign a GET with ONLY the `host` header (service `iotdevicegateway`).
 *   2. Append `X-Amz-Security-Token` to the query string AFTER signing — IoT's
 *      device gateway rejects the handshake if the session token is part of the
 *      signed canonical query (unlike most AWS services). This is why the generic
 *      `@aws-sdk/signature-v4` presign does NOT work here.
 *
 * The signature is fresh per call; the hook re-signs on every (re)connect.
 */
export async function presignIotWssUrl(
  endpoint: string,
  region: string,
  credentials: AwsCreds
): Promise<string> {
  const service = "iotdevicegateway"
  const algorithm = "AWS4-HMAC-SHA256"
  const method = "GET"
  const canonicalUri = "/mqtt"
  const { accessKeyId, secretAccessKey, sessionToken } = credentials

  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "") // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8) // YYYYMMDD
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`

  // Canonical query (alphabetical, URL-encoded). NOTE: no security token here.
  let canonicalQuery =
    "X-Amz-Algorithm=AWS4-HMAC-SHA256" +
    "&X-Amz-Credential=" +
    encodeURIComponent(`${accessKeyId}/${credentialScope}`) +
    "&X-Amz-Date=" +
    amzDate +
    "&X-Amz-SignedHeaders=host"

  const canonicalHeaders = `host:${endpoint}\n`
  const payloadHash = await sha256Hex("")
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    "host",
    payloadHash,
  ].join("\n")

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n")

  const kDate = await hmac(`AWS4${secretAccessKey}`, dateStamp)
  const kRegion = await hmac(kDate, region)
  const kService = await hmac(kRegion, service)
  const kSigning = await hmac(kService, "aws4_request")
  const signature = toHex(await hmac(kSigning, stringToSign))

  canonicalQuery += `&X-Amz-Signature=${signature}`
  if (sessionToken) {
    canonicalQuery += `&X-Amz-Security-Token=${encodeURIComponent(sessionToken)}`
  }

  return `wss://${endpoint}${canonicalUri}?${canonicalQuery}`
}
