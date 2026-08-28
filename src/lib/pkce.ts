// PKCE + state helpers for the Cognito Hosted-UI authorization-code flow.
// The verifier, state and the post-login destination are stashed in
// sessionStorage for the in-flight login and read back when Cognito redirects
// to /auth/callback.

const VERIFIER_KEY = "oauth_pkce_verifier"
const STATE_KEY = "oauth_pkce_state"
const RETURN_TO_KEY = "oauth_return_to"

function base64UrlEncode(bytes: Uint8Array): string {
  let str = ""
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function randomString(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

export function generateCodeVerifier(): string {
  // 32 random bytes -> 43-char base64url string (within the 43-128 spec range).
  return randomString(32)
}

export async function codeChallengeFromVerifier(
  verifier: string
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  )
  return base64UrlEncode(new Uint8Array(digest))
}

export function generateState(): string {
  return randomString(16)
}

export function rememberPkce(
  verifier: string,
  state: string,
  returnTo?: string
): void {
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(STATE_KEY, state)
  if (returnTo) sessionStorage.setItem(RETURN_TO_KEY, returnTo)
  else sessionStorage.removeItem(RETURN_TO_KEY)
}

/**
 * Read back the verifier, validating that the returned `state` matches what we
 * stored. Clears the stash on read so a code can only be exchanged once.
 */
export function takePkce(returnedState: string): {
  verifier: string
  returnTo: string | undefined
} {
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  const state = sessionStorage.getItem(STATE_KEY)
  const returnTo = sessionStorage.getItem(RETURN_TO_KEY) ?? undefined
  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)
  sessionStorage.removeItem(RETURN_TO_KEY)
  if (!verifier || !state) throw new Error("Missing PKCE verifier")
  if (state !== returnedState) throw new Error("OAuth state mismatch")
  return { verifier, returnTo }
}
