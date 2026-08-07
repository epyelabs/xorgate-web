/**
 * Structural equality — the single change-detection strategy for the settings
 * plane, on both sides of the wire (`agent/config-sync.ts` carries the same
 * function, deliberately identical).
 *
 * `JSON.stringify` is NOT sound here: the device re-serializes settings.json in
 * its own key order, so two documents that mean the same thing routinely
 * stringify differently.
 *
 * Lives in `lib/` rather than beside its first caller because
 * `lib/device-config-status.ts` needs it too, and a lib importing a hook that
 * already imports that lib would be a cycle.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  ) {
    return false
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao)
  if (ak.length !== Object.keys(bo).length) return false
  return ak.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k])
  )
}
