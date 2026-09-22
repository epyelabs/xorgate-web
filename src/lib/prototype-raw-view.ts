/**
 * PROTOTYPE ONLY — delete this file to graduate the Raw view.
 *
 * `activeStreamsViewType` is a contract-generated pref: its values come from a
 * backend zod enum (`ACTIVE_STREAMS_VIEW_TYPES` in xorgate-core-service
 * src/config-registry/ui-prefs.ts), which is serialized into four committed
 * config-contract.json copies and generates the SDK's TS union. Until "raw" is
 * added there, `PATCH /devices/{id}/ui-prefs` rejects it — so while we are only
 * LOOKING at the layout, the choice lives in localStorage instead of the server.
 *
 * Precedence: an override that is on wins; otherwise the stored pref applies as
 * it always has. Only "raw" ever bypasses the server — picking Card or Map
 * clears the override and saves normally, so nothing about today's behaviour
 * changes.
 *
 * To graduate: add 'raw' to the backend enum, `npm run contract:generate`, move
 * the sha256 pin in test/sdk-vendor-drift.test.ts, re-vendor + regenerate +
 * publish @xorgate/sdk, then delete this file, its two call sites, and the
 * `| "raw"` widening in src/lib/xorgate.ts.
 */

const KEY_PREFIX = "xg-prototype-raw-view:"

// localStorage throws in a locked-down browser profile; the view type is not
// worth breaking the page over, so every access fails soft to "no override".
export function readRawOverride(deviceId: string): boolean {
  try {
    return localStorage.getItem(`${KEY_PREFIX}${deviceId}`) === "1"
  } catch {
    return false
  }
}

export function writeRawOverride(deviceId: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(`${KEY_PREFIX}${deviceId}`, "1")
    else localStorage.removeItem(`${KEY_PREFIX}${deviceId}`)
  } catch {
    // ignore
  }
}
