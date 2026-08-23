import { xg } from "./xorgate"

// Per-organization connector credentials (M7). Write-only by design: reads
// return presence + last-rotated metadata, never the key value. The backend
// stores one Secrets Manager secret per org per provider; the workflow engine
// prefers the org key over the platform default at run time.

export type CredentialProvider = "google_roads" | "here" | "anthropic"
export type ValidatableProvider = CredentialProvider | "osm"

export interface OrgCredential {
  provider: CredentialProvider
  configured: boolean
  lastRotatedAt: string | null
}

export interface CredentialValidation {
  provider: ValidatableProvider
  keySource: "candidate" | "organization" | "platform" | "none"
  ok: boolean
  message: string
}

export async function listOrgCredentials(): Promise<{
  credentials: OrgCredential[]
}> {
  return xg().request("GET", "/organization-credentials")
}

export async function setOrgCredential(
  provider: CredentialProvider,
  apiKey: string
): Promise<{ credential: OrgCredential }> {
  return xg().request("PUT", `/organization-credentials/${provider}`, {
    body: { apiKey },
  })
}

export async function clearOrgCredential(
  provider: CredentialProvider
): Promise<void> {
  await xg().request<void>("DELETE", `/organization-credentials/${provider}`)
}

export async function validateOrgCredential(
  provider: ValidatableProvider,
  apiKey?: string
): Promise<{ validation: CredentialValidation }> {
  return xg().request("POST", `/organization-credentials/${provider}/validate`, {
    body: apiKey ? { apiKey } : {},
  })
}
