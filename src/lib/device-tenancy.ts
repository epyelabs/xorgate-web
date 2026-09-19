// Has the DEVICE caught up with the workspace the cloud says it belongs to?
//
// A transfer writes three facts — the `devices.workspace_id` row, the AWS IoT
// thing attributes and the `scope` block of the retained config — and the
// device learns about the third one whenever it next connects. The cloud is
// authoritative the instant the row is written; the device's own report is the
// only evidence it has actually moved.
//
// Two traps this module exists to avoid repeating in components:
//
//  - **`configRev` is not evidence.** A scope change deliberately does not move
//    the rev, and it was verified on hardware to read the same value before and
//    after a successful transfer. Comparing revs here would answer a different
//    question and answer it wrong.
//  - **There are THREE outcomes, not two.** An agent older than `v0.0.6` sends
//    no `telemetryScope` at all, and its absence means "never told us", which
//    is a different fact from "told us, and is behind". Collapsing `unknown`
//    into `pending` would show a permanent "catching up" badge on every device
//    that is simply running an older agent.
//
// Mirrors `transferAdoption()` / `reportedScope()` in the backend's
// `services/device-transfer.ts`, which is what `TransferSummary.adoption`
// carries at transfer time. This is the same read, done later and from a
// device row, so the badge survives a reload.

import type { Device, TransferAdoption } from "@xorgate/sdk"

export interface ReportedTelemetryScope {
  scoped?: boolean
  organizationId?: string
  workspaceId?: string
}

/**
 * The device's own account of which telemetry topic it publishes on, or null
 * when it has never said — an agent older than `v0.0.6`, or a device that has
 * never connected.
 */
export function reportedTelemetryScope(
  device: Device | null | undefined
): ReportedTelemetryScope | null {
  const scope = device?.reportedConfig?.effective?.telemetryScope
  if (!scope || typeof scope !== "object") return null
  return scope as ReportedTelemetryScope
}

/**
 * Whether the device has adopted the tenancy the cloud holds for it.
 *
 * `pending` immediately after a transfer is NORMAL — the move is already
 * complete and authoritative in the cloud, and an offline device converges the
 * moment it next connects. Never render it as a failure.
 */
export function deviceAdoption(
  device: Device | null | undefined,
  organizationId: string | null
): TransferAdoption {
  const scope = reportedTelemetryScope(device)
  if (!scope || !device || organizationId === null) return "unknown"
  return scope.organizationId === organizationId &&
    scope.workspaceId === device.workspaceId
    ? "confirmed"
    : "pending"
}
