/**
 * How this app stays current WITHOUT a page reload, in one place.
 *
 * Two mechanisms, because neither covers the other's case:
 *
 *  1. The query cache (see `lib/query-client.ts`). It polls while the tab is
 *     visible and refetches what went stale on return. It is the only thing
 *     that can report a device going AWAY: the platform flips `device.status`
 *     from the broker's last-will, which by definition arrives on a socket
 *     this browser is not holding.
 *  2. The live MQTT plane (see `store/presence.ts`). A telemetry frame from a
 *     device IS presence, so a device coming BACK reads online in about a
 *     second rather than at the next poll.
 */

/** Cadence of the devices poll (list page and device layout), and the cache's
 * default staleTime: inside this window, revisiting a screen costs nothing. */
export const FLEET_POLL_MS = 20_000

/** Cadence of the media-runs poll on the Media Recordings tab, so open
 * sessions' rollups keep growing while a backlog drains. */
export const RUNS_POLL_MS = 5_000

/** How long a live frame keeps counting as presence. Generous next to the ~1Hz
 * publish rate, so one dropped frame does not flap the status dot. */
export const LIVE_PRESENCE_TTL_MS = 45_000
