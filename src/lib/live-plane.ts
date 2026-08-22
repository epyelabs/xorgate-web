import { xg } from "./xorgate"

// Small shared pieces for the app's OWN MQTT-over-WSS connections (workflow
// sim progress, webcam ingest). Device telemetry and video live entirely in
// @xorgate/react; these helpers exist because the workflow plane is outside
// the SDK's scope, so those hooks presign and connect themselves — with the
// package's exported presignIotWssUrl and the provider's useLiveCredentials,
// not a local copy of either.

/**
 * MQTT client id for a browser connection. The browser IoT policy scopes
 * `iot:Connect` to `client/${cognito-identity.amazonaws.com:sub}*`, so the id
 * MUST begin with the caller's own Cognito identity id (from POST
 * /live/access) or the broker refuses the CONNECT. The random suffix keeps a
 * user's own tabs/connections from displacing each other; `role` is a
 * human-readable debugging hint that survives into CloudWatch.
 */
export function browserClientId(identityId: string, role: string): string {
  return `${identityId}-${role}-${crypto.randomUUID()}`
}

/**
 * Grants the caller's Cognito identity access to the live plane (AWS IoT
 * authorizes Cognito identities via an attached IoT policy, not the IAM
 * role). Idempotent; returns the identityId the client id must start with.
 * Not modeled by `@xorgate/sdk`, hence the raw request.
 */
export async function attachLiveAccess(): Promise<{
  attached: boolean
  identityId: string
  policyName: string
}> {
  return xg().request<{
    attached: boolean
    identityId: string
    policyName: string
  }>("POST", "/live/access")
}
