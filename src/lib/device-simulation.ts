// Simulated devices (plans/xorgate-device-simulator, Phase 5).
//
// A simulated device is the real device agent replaying a recorded drive in a
// hosted container. Everything about it is a normal device EXCEPT three things
// this module owns the wording and the rules for:
//
//  - `device.simulated` is the source of truth for "is this a sim". It is a
//    server-side fact fixed at creation. The agent's own reported mode reads
//    `replay` for a sim, and `reportedAgentMode` must stay reported-only, so
//    nothing here keys off the mode.
//  - The `simulation` config namespace picks the scenario. All three fields
//    are required and the namespace is replaced whole, so a scenario switch
//    always writes the complete namespace (`buildSimulationConfig`).
//  - The host's own report (`hostState` / `hostMessage`), which is the only
//    progress signal while the container is starting or parked.

import {
  isXorgateError,
  type SimulationConfig,
  type SimulationHostState,
  type SimulationScenario,
} from "@xorgate/sdk"
import contract from "@/lib/config-contract.json"

/** The namespace defaults, straight off the contract artifact. */
export const SIMULATION_DEFAULTS: SimulationConfig =
  contract.namespaces.simulation.defaults

/**
 * The stored `simulation` namespace, or null when the device holds none (a real
 * device always; a sim only if someone cleared it). Defensive because
 * `device.config` is a document, not a typed row.
 */
export function storedSimulationConfig(config: unknown): SimulationConfig | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null
  const sim = (config as { simulation?: unknown }).simulation
  if (!sim || typeof sim !== "object" || Array.isArray(sim)) return null
  const s = sim as Partial<Record<keyof SimulationConfig, unknown>>
  return {
    scenarioId:
      typeof s.scenarioId === "string" ? s.scenarioId : SIMULATION_DEFAULTS.scenarioId,
    loop: typeof s.loop === "boolean" ? s.loop : SIMULATION_DEFAULTS.loop,
    gapSeconds:
      typeof s.gapSeconds === "number" ? s.gapSeconds : SIMULATION_DEFAULTS.gapSeconds,
  }
}

/**
 * The whole namespace for "switch to `scenarioId`", keeping the stored loop and
 * gap. Built from a FRESH read of the device (the caller's job), so another
 * operator's loop/gap edit is not overwritten by a cached copy. A device with no
 * stored namespace falls back to the contract defaults rather than sending the
 * partial `{scenarioId}` the API rejects with a 400.
 */
export function buildSimulationConfig(
  config: unknown,
  scenarioId: string
): SimulationConfig {
  return { ...(storedSimulationConfig(config) ?? SIMULATION_DEFAULTS), scenarioId }
}

export const HOST_STATE_LABELS: Record<SimulationHostState, string> = {
  pending: "Waiting for the simulator host",
  starting: "Starting",
  running: "Running",
  stopped: "Powered off",
  error: "Host error",
}

/** Tone for a host state chip: neutral while moving, red only for `error`. */
export function hostStateTone(state: SimulationHostState): "ok" | "busy" | "off" | "error" {
  switch (state) {
    case "running":
      return "ok"
    case "pending":
    case "starting":
      return "busy"
    case "stopped":
      return "off"
    case "error":
      return "error"
  }
}

/**
 * The title of the scenario a sim is configured for, for the at-a-glance label
 * beside the Simulated badge. Keyed off the stored namespace (the desired
 * scenario, what the Settings card shows). Null while the catalog is loading,
 * for a device with no namespace, or for an id the catalog no longer carries:
 * the badge then reads plain "Simulated" rather than flashing a raw id.
 */
export function simulationScenarioTitle(
  config: unknown,
  scenarios: readonly Pick<SimulationScenario, "id" | "title">[] | undefined
): string | null {
  const scenarioId = storedSimulationConfig(config)?.scenarioId
  if (!scenarioId || !scenarios) return null
  return scenarios.find((s) => s.id === scenarioId)?.title ?? null
}

/** "15 min · 7.9 km · max 109 km/h", skipping whatever the catalog left null. */
export function formatScenarioStats(
  s: Pick<SimulationScenario, "durationMs" | "distanceM" | "maxKph">
): string {
  const parts: string[] = []
  if (s.durationMs !== null) {
    parts.push(`${Math.max(1, Math.round(s.durationMs / 60_000))} min`)
  }
  if (s.distanceM !== null) {
    const km = s.distanceM / 1000
    parts.push(`${km < 10 ? km.toFixed(1) : Math.round(km)} km`)
  }
  if (s.maxKph !== null) parts.push(`max ${Math.round(s.maxKph)} km/h`)
  return parts.join(" · ")
}

/**
 * Operator-facing text for a failed create. The two simulation codes get their
 * own sentence because the generic API message is not actionable: the quota
 * one has to say WHICH quota (this organization's, or the whole platform's)
 * and its limit, and the provision one has to say that nothing was left behind
 * (the backend rolls the device back), so a retry is safe.
 */
export function simulationCreateErrorMessage(err: unknown, fallback: string): string {
  if (!isXorgateError(err)) return fallback
  if (err.code === "SIMULATION_QUOTA_EXCEEDED") {
    const d = err.details ?? {}
    const limit = typeof d.limit === "number" ? d.limit : null
    const scope = d.scope === "global" ? "global" : "organization"
    if (scope === "global") {
      return limit === null
        ? "The simulator host is full. Try again once another simulation is deleted."
        : `The simulator host is full (${limit} simulations across all organizations). Try again once one is deleted.`
    }
    return limit === null
      ? "This organization has reached its simulation limit. Delete a simulated device to make room."
      : `This organization already has ${limit} simulated device${limit === 1 ? "" : "s"}, the limit. Delete one to make room.`
  }
  if (err.code === "SIMULATION_PROVISION_FAILED") {
    return "Couldn't provision the simulated device. Nothing was created, so it is safe to try again."
  }
  return fallback
}
