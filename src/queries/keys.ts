/**
 * Every query key in the app, built here and nowhere else.
 *
 * Two invariants the factory enforces:
 *
 *  - Tenancy lives in the key. The SDK client injects the org/workspace as
 *    headers, so two tenants' requests are otherwise identical; leaving the
 *    ids out of the key would serve one tenant's fleet to another after a
 *    switch. Org-owned data hangs off `["org", orgId, ...]`, workspace-owned
 *    data off `["org", orgId, "ws", wsId, ...]`.
 *
 *  - Per-device keys EXTEND the device key, so
 *    `invalidateQueries({queryKey: qk.device(...)})` also refreshes that
 *    device's telemetry, sessions and workflow lists in one call.
 *
 * Ids are typed `string | null` because the store holds null before the
 * bootstrap answers; the hooks gate on that with `enabled`, and a null in a
 * key can never collide with a real tenant's entry.
 */

type Id = string | null

export const qk = {
  org: (orgId: Id) => ["org", orgId] as const,
  members: (orgId: Id) => [...qk.org(orgId), "members"] as const,
  apiKeys: (orgId: Id) => [...qk.org(orgId), "api-keys"] as const,
  // The model catalog is platform-wide, but reads go through the org-scoped
  // client, so it is keyed (and cleared) per org anyway.
  deviceModels: (orgId: Id) => [...qk.org(orgId), "device-models"] as const,
  deviceModel: (orgId: Id, modelId: string) =>
    [...qk.org(orgId), "device-model", modelId] as const,

  ws: (orgId: Id, wsId: Id) => [...qk.org(orgId), "ws", wsId] as const,
  fleet: (orgId: Id, wsId: Id) => [...qk.ws(orgId, wsId), "devices"] as const,

  device: (orgId: Id, wsId: Id, deviceId: string) =>
    [...qk.ws(orgId, wsId), "device", deviceId] as const,
  telemetryReadings: (
    orgId: Id,
    wsId: Id,
    deviceId: string,
    params: Record<string, unknown>
  ) => [...qk.device(orgId, wsId, deviceId), "telemetry-readings", params] as const,
  telemetryRecent: (
    orgId: Id,
    wsId: Id,
    deviceId: string,
    metricsKey: string,
    limit: number
  ) =>
    [
      ...qk.device(orgId, wsId, deviceId),
      "telemetry-recent",
      metricsKey,
      limit,
    ] as const,
  sessionRuns: (
    orgId: Id,
    wsId: Id,
    deviceId: string,
    params: Record<string, unknown>
  ) => [...qk.device(orgId, wsId, deviceId), "session-runs", params] as const,
  segments: (orgId: Id, wsId: Id, deviceId: string, sessionId: string) =>
    [...qk.device(orgId, wsId, deviceId), "segments", sessionId] as const,
  deviceAttachments: (orgId: Id, wsId: Id, deviceId: string) =>
    [...qk.device(orgId, wsId, deviceId), "workflow-attachments"] as const,
  deviceWorkflowRuns: (
    orgId: Id,
    wsId: Id,
    deviceId: string,
    params: Record<string, unknown>
  ) => [...qk.device(orgId, wsId, deviceId), "workflow-runs", params] as const,

  workflowTemplates: (orgId: Id, wsId: Id) =>
    [...qk.ws(orgId, wsId), "workflow-templates"] as const,
  // Under the templates prefix on purpose: invalidating the list refreshes the
  // tag vocabulary too, which is what a save that changed tags needs.
  workflowTemplateTags: (orgId: Id, wsId: Id) =>
    [...qk.workflowTemplates(orgId, wsId), "tags"] as const,
  workflowTemplate: (orgId: Id, wsId: Id, templateId: string) =>
    [...qk.ws(orgId, wsId), "workflow-template", templateId] as const,
  workflowInstances: (orgId: Id, wsId: Id, params: Record<string, unknown>) =>
    [...qk.ws(orgId, wsId), "workflow-instances", params] as const,
  workflowInstance: (orgId: Id, wsId: Id, instanceId: string) =>
    [...qk.ws(orgId, wsId), "workflow-instance", instanceId] as const,
} as const
