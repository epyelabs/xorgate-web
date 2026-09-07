import { useAuthStore } from "@/store/auth"
import { redirectToHostedLogout } from "@/lib/cognito"

/** Just enough of the router's `navigate` for the one hop this makes. */
type NavigateToLogin = (opts: {
  to: "/login"
  replace: true
}) => Promise<void> | void

/**
 * The one sign-out sequence, shared by the sidebar's "Log out" and the account
 * screen's delete-account confirm.
 *
 * Order matters. `logout()` clears the query cache, and the page the user
 * pressed the button on is still mounted: every list on it flips back to its
 * loading skeleton, and that half-empty page stays on screen for the whole
 * Hosted-UI redirect — long enough to read as a broken render rather than a
 * sign-out. So the hold goes up first, in the same event handler, and React
 * paints one frame straight from the app to the hold.
 *
 * Hosted UI keeps the hold up deliberately: `window.location.assign()` only
 * *starts* a navigation, and the current document keeps rendering until the
 * round trip lands back on /login.
 */
export async function performSignOut(navigate: NavigateToLogin): Promise<void> {
  const { beginSignOut, logout } = useAuthStore.getState()
  beginSignOut()
  logout()
  // The Hosted-UI cookie round trip reloads the document, which resets the
  // store on its own — leave the hold up until it does.
  if (redirectToHostedLogout()) return
  await navigate({ to: "/login", replace: true })
}
