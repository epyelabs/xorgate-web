import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  CognitoUserSession,
  CognitoIdToken,
  CognitoAccessToken,
  CognitoRefreshToken,
} from "amazon-cognito-identity-js"
import {
  generateCodeVerifier,
  codeChallengeFromVerifier,
  generateState,
  rememberPkce,
  takePkce,
} from "@/lib/pkce"

const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string

const userPool = new CognitoUserPool({
  UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
  ClientId: CLIENT_ID,
})

// Cognito Hosted-UI base URL (https://<prefix>.auth.<region>.amazoncognito.com),
// the HostedUiBaseUrl output of the auth stack. Unset means no federation: the
// Google button is hidden and every OAuth entry point throws.
const COGNITO_DOMAIN = (import.meta.env.VITE_COGNITO_DOMAIN as string | undefined)
  ?.replace(/\/+$/, "")

/** Federated identity providers wired in Cognito (Hosted-UI names). */
export type OAuthProvider = "Google"

/** True when Hosted-UI federation is configured (controls button visibility). */
export const oauthEnabled = Boolean(COGNITO_DOMAIN)

// The callback and logout URLs are derived from the page origin rather than
// configured, so one build serves localhost and the deployed hosts alike; the
// auth stack registers `${origin}/auth/callback` and `${origin}/login` for
// every allowed web origin.
function oauthRedirectUri(): string {
  return `${window.location.origin}/auth/callback`
}
function oauthLogoutUri(): string {
  return `${window.location.origin}/login`
}

function requireOAuthDomain(): string {
  if (!COGNITO_DOMAIN) {
    throw new Error("Google sign-in is not configured (VITE_COGNITO_DOMAIN)")
  }
  return COGNITO_DOMAIN
}

export function signUp(email: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const attributes = [
      new CognitoUserAttribute({ Name: "email", Value: email }),
    ]
    userPool.signUp(email, password, attributes, [], (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

export function confirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool })
    user.confirmRegistration(code, true, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

// A successful sign-in either returns a session, or reports that the account is
// in FORCE_CHANGE_PASSWORD (an admin-created invitee signing in with the
// temporary password) and must set a new one via completeNewPassword().
export type SignInResult =
  | { challenge: "NONE"; session: CognitoUserSession }
  | { challenge: "NEW_PASSWORD_REQUIRED" }

// The CognitoUser mid-challenge is held here so completeNewPassword() can finish
// the same authentication flow. Set only between signIn() resolving with
// NEW_PASSWORD_REQUIRED and completeNewPassword() succeeding.
let pendingChallengeUser: CognitoUser | null = null

export function signIn(
  email: string,
  password: string
): Promise<SignInResult> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool })
    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    })
    user.authenticateUser(authDetails, {
      onSuccess: (session) => {
        pendingChallengeUser = null
        resolve({ challenge: "NONE", session })
      },
      onFailure: (err) => {
        pendingChallengeUser = null
        reject(err)
      },
      newPasswordRequired: () => {
        pendingChallengeUser = user
        resolve({ challenge: "NEW_PASSWORD_REQUIRED" })
      },
    })
  })
}

// Completes the NEW_PASSWORD_REQUIRED challenge for the user returned by the most
// recent signIn(). email/email_verified were set at admin-create time, so no
// additional required attributes are supplied.
export function completeNewPassword(
  newPassword: string
): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    const user = pendingChallengeUser
    if (!user) {
      return reject(new Error("No password challenge in progress"))
    }
    user.completeNewPasswordChallenge(
      newPassword,
      {},
      {
        onSuccess: (session) => {
          pendingChallengeUser = null
          resolve(session)
        },
        onFailure: (err) => reject(err),
      }
    )
  })
}

/**
 * Forgot password, step 1: Cognito emails a reset code to the account's
 * verified address (the pool's recovery channel is email only). Resolves as
 * soon as the code is on its way; the code itself never reaches the browser.
 */
export function forgotPassword(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool })
    user.forgotPassword({
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
      // Called INSTEAD of onSuccess when the SDK expects the code to be
      // collected by the caller, which is exactly this flow.
      inputVerificationCode: () => resolve(),
    })
  })
}

/** Forgot password, step 2: the emailed code authorizes the new password. */
export function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool })
    user.confirmPassword(code, newPassword, {
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
    })
  })
}

/**
 * Change the signed-in user's password. Cognito is the credential store, so
 * this never touches the platform API — the browser talks to Cognito directly
 * and the session survives, meaning there is nothing to sign out of afterwards.
 *
 * Federated (Google) users have no Cognito password at all; the account screen
 * hides the form for them rather than letting this fail. See `isFederated`.
 */
export function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = userPool.getCurrentUser()
    if (!user) return reject(new Error("No signed-in user"))
    // getSession() is what attaches the session to the CognitoUser; without it
    // changePassword throws "User is not authenticated" even on a live session.
    user.getSession(
      (err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session) return reject(err ?? new Error("Session expired"))
        user.changePassword(currentPassword, newPassword, (changeErr) => {
          if (changeErr) return reject(changeErr)
          resolve()
        })
      }
    )
  })
}

/**
 * Whether this session signed in through a federated provider (Google), which
 * Cognito records as an `identities` claim on the ID token. Such a user has no
 * password in the pool, so anything password-shaped has to be hidden rather
 * than offered and then refused.
 *
 * Null while the session is still loading, so a caller can tell "not federated"
 * apart from "not known yet" and avoid flashing the wrong UI.
 */
export async function isFederatedUser(): Promise<boolean | null> {
  const session = await getCurrentSession()
  if (!session) return null
  const claims = session.getIdToken().decodePayload() as {
    identities?: unknown[]
  }
  return Array.isArray(claims.identities) && claims.identities.length > 0
}

export function signOut(): void {
  const user = userPool.getCurrentUser()
  if (user) user.signOut()
}

export function getCurrentSession(): Promise<CognitoUserSession | null> {
  return new Promise((resolve) => {
    const user = userPool.getCurrentUser()
    if (!user) return resolve(null)
    user.getSession(
      (err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session) return resolve(null)
        resolve(session)
      }
    )
  })
}

export async function getIdToken(): Promise<string | null> {
  const session = await getCurrentSession()
  if (!session) return null
  return session.getIdToken().getJwtToken()
}

/**
 * Kick off the Hosted-UI authorization-code-with-PKCE flow for a social
 * provider. Redirects the browser to Cognito, which bounces to the provider and
 * back to /auth/callback with a `code`. `returnTo` (a same-origin path) is
 * stashed alongside the PKCE verifier and handed back by completeOAuthLogin().
 */
export async function signInWithProvider(
  provider: OAuthProvider,
  returnTo?: string
): Promise<void> {
  const domain = requireOAuthDomain()
  const verifier = generateCodeVerifier()
  const state = generateState()
  const challenge = await codeChallengeFromVerifier(verifier)
  rememberPkce(verifier, state, returnTo)

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: oauthRedirectUri(),
    identity_provider: provider,
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  })
  window.location.assign(`${domain}/oauth2/authorize?${params.toString()}`)
}

function decodeJwt(token: string): Record<string, unknown> {
  return JSON.parse(atob(token.split(".")[1]))
}

/**
 * Exchange the authorization `code` for tokens and hydrate the
 * amazon-cognito-identity-js session, so getCurrentSession() / getIdToken() /
 * refresh / signOut() all keep working exactly as for password login.
 */
export async function completeOAuthLogin(
  code: string,
  state: string
): Promise<{ session: CognitoUserSession; returnTo: string | undefined }> {
  const domain = requireOAuthDomain()
  const { verifier, returnTo } = takePkce(state)

  const res = await fetch(`${domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: oauthRedirectUri(),
      code,
      code_verifier: verifier,
    }).toString(),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText)
    throw new Error(`Token exchange failed: ${detail}`)
  }

  const tokens = (await res.json()) as {
    id_token: string
    access_token: string
    refresh_token: string
  }

  const session = new CognitoUserSession({
    IdToken: new CognitoIdToken({ IdToken: tokens.id_token }),
    AccessToken: new CognitoAccessToken({ AccessToken: tokens.access_token }),
    RefreshToken: new CognitoRefreshToken({
      RefreshToken: tokens.refresh_token,
    }),
  })

  const claims = decodeJwt(tokens.id_token)
  const username = String(claims["cognito:username"] ?? claims["sub"])
  const user = new CognitoUser({ Username: username, Pool: userPool })
  // Persists the SDK's localStorage keys (LastAuthUser + tokens) that
  // getCurrentUser()/getSession() read on subsequent loads.
  user.setSignInUserSession(session)

  return { session, returnTo }
}

/**
 * When Hosted UI is configured, clear the Cognito Hosted-UI cookie by
 * navigating to /logout (which lands back on /login), so the next Google
 * sign-in re-prompts instead of silently reusing the provider session. Call
 * AFTER the local session is cleared. Returns false, and does nothing, when
 * federation is not configured: the caller then routes to /login itself.
 */
export function redirectToHostedLogout(): boolean {
  if (!COGNITO_DOMAIN) return false
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    logout_uri: oauthLogoutUri(),
  })
  window.location.assign(`${COGNITO_DOMAIN}/logout?${params.toString()}`)
  return true
}
