import { QueryClient } from "@tanstack/react-query"
import { isXorgateError } from "@xorgate/sdk"
import { FLEET_POLL_MS } from "@/lib/freshness"

/**
 * Worth an automatic retry? The SDK already classifies its own errors
 * (`retryable` covers network failures, 5xx and 429); anything else transient
 * a browser produces surfaces as a TypeError from fetch. A 401 has already
 * signed the user out, and a 404 stays a 404, so neither is retried.
 */
export function isTransient(error: unknown): boolean {
  if (isXorgateError(error)) return error.retryable
  return error instanceof TypeError
}

/**
 * One cache for the whole app, and the place its freshness policy is stated
 * once instead of at every call site.
 *
 * The defaults below are what make a tab switch feel instant: a screen that
 * remounts inside `staleTime` renders the cached answer immediately and asks
 * for nothing, and a screen that remounts after it renders the cached answer
 * immediately and refetches BEHIND it. Either way nobody watches a spinner
 * for data the app already has.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Matched to the fleet poll: inside this window, revisiting a screen is
      // free. Deliberately not zero: every screen here reads state that
      // changes on the order of seconds, not milliseconds.
      staleTime: FLEET_POLL_MS,
      // How long an unused answer is kept for the next visit. Long enough to
      // cover moving around the app, short enough that a screen reopened much
      // later does not flash a stale answer before its refetch lands.
      gcTime: 5 * 60_000,
      // Coming back to the tab refetches whatever went stale while away: the
      // "left it open overnight" problem, handled by the cache rather than by
      // each screen.
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      // Intervals pause while the tab is hidden. A throttled background poll
      // buys nothing that the refetch-on-return does not already cover.
      refetchIntervalInBackground: false,
      retry: (count, error) => isTransient(error) && count < 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    mutations: {
      // A write is not safely repeatable without knowing the endpoint; the
      // screens surface the failure and let the operator decide.
      retry: 0,
    },
  },
})
