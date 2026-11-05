import {
  simulationBindingSchema,
  type SimulationApiBinding,
} from "@/lib/workflow-sim-schemas"
import {
  isTelemetryBinding,
  isVideoBinding,
  isVideoSource,
  type SourceBinding,
} from "./simulator-types"

// The reverse of resolveApiBindings, for Load of a saved run: rebuilds the
// panel's source bindings from the run's API bindings snapshot (the union the
// simulator POSTed), without any API call. Pure; unit-tested.

export type UnrestoredReason =
  // An on-device session binding names only the session id; the panel's
  // session binding needs the device, its name and the MediaSession record.
  | "needs-fetch"
  // The source node now has a different kind (video vs telemetry).
  | "kind-mismatch"
  // Not one of the known API binding kinds (or a malformed entry).
  | "unknown"

export interface RestoredBindings {
  bindings: Record<string, SourceBinding>
  unrestored: { nodeId: string; kind: string; reason: UnrestoredReason }[]
  // Snapshot entries whose node is no longer in the graph.
  skipped: string[]
  // Sources the snapshot could not rebuild but that already hold a
  // compatible binding in the panel: that binding stays, nothing to report.
  kept: string[]
}

/** Whether a binding can feed a source of this kind (video vs telemetry). */
export function isCompatibleBinding(
  binding: SourceBinding,
  video: boolean
): boolean {
  if (binding.kind === "uploaded-file")
    return (binding.media === "video") === video
  return video ? isVideoBinding(binding) : isTelemetryBinding(binding)
}

/** File name out of an upload key (its last path segment). */
export function uploadKeyName(uploadKey: string): string {
  const last = uploadKey.split("/").filter(Boolean).pop()
  return last && last.length > 0 ? last : uploadKey
}

function restoreOne(
  api: SimulationApiBinding,
  video: boolean,
  deviceNames: Record<string, string>
): SourceBinding | UnrestoredReason {
  switch (api.kind) {
    case "video_file":
      if (!video) return "kind-mismatch"
      return {
        kind: "uploaded-file",
        media: "video",
        uploadKey: api.uploadKey,
        name: uploadKeyName(api.uploadKey),
      }
    case "telemetry_csv":
      if (video) return "kind-mismatch"
      return {
        kind: "uploaded-file",
        media: "csv",
        uploadKey: api.uploadKey,
        name: uploadKeyName(api.uploadKey),
      }
    case "device_telemetry":
      if (video) return "kind-mismatch"
      // The API window is explicit ISO from/to; resolveApiBindings parses ISO
      // as readily as a datetime-local value, so the instants round-trip.
      // `metrics` has no slot on the panel binding (the panel never sends it).
      return {
        kind: "device-telemetry",
        deviceId: api.deviceId,
        deviceName:
          deviceNames[api.deviceId] ?? `Device ${api.deviceId.slice(0, 8)}`,
        window: { mode: "range", from: api.window.from, to: api.window.to },
      }
    case "webcam":
      if (!video) return "kind-mismatch"
      // The camera choice is not in the snapshot: the browser's default.
      return { kind: "video-webcam", name: "Webcam" }
    case "session":
      return "needs-fetch"
  }
}

export function restoreBindings(
  snapshot: unknown,
  sources: { id: string; catalogType: string }[],
  deviceNames: Record<string, string> = {},
  // What the panel has bound right now (kept where nothing can be rebuilt).
  current: Record<string, SourceBinding> = {}
): RestoredBindings {
  const out: RestoredBindings = {
    bindings: {},
    unrestored: [],
    skipped: [],
    kept: [],
  }
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    return out
  const byId = new Map(sources.map((s) => [s.id, s]))
  for (const [nodeId, raw] of Object.entries(snapshot)) {
    const source = byId.get(nodeId)
    if (!source) {
      out.skipped.push(nodeId)
      continue
    }
    const video = isVideoSource(source.catalogType)
    const existing = current[nodeId]
    const keepsExisting =
      existing !== undefined && isCompatibleBinding(existing, video)
    const parsed = simulationBindingSchema.safeParse(raw)
    const kind =
      raw && typeof raw === "object" && "kind" in raw
        ? String((raw as { kind: unknown }).kind)
        : "unknown"
    const result = parsed.success
      ? restoreOne(parsed.data, video, deviceNames)
      : ("unknown" as const)
    if (typeof result === "string") {
      if (keepsExisting) out.kept.push(nodeId)
      else out.unrestored.push({ nodeId, kind, reason: result })
    } else {
      out.bindings[nodeId] = result
    }
  }
  return out
}
