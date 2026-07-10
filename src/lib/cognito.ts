import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  type CognitoUserSession,
} from "amazon-cognito-identity-js"

const userPool = new CognitoUserPool({
  UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
  ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
})

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
