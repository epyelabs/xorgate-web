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

  // Offers are an ORGANIZATION-level event — a device you are being given is
  // not yours yet, and has no workspace of yours to hang off.
  transferOffers: (orgId: Id, params: Record<string, unknown>) =>
    [...qk.org(orgId), "transfer-offers", params] as const,
  // Keyed by org because the same code previewed from two organizations is two
  // different answers (yours reads; a stranger's 404s).
  transferOfferPreview: (orgId: Id, code: string) =>
    [...qk.org(orgId), "transfer-offer-preview", code] as const,

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
  // Both extend the device key, so the invalidation a transfer already does
  // (qk.device) clears the dry run and the handover history with it.
  deviceTransferPreview: (
    orgId: Id,
    wsId: Id,
    deviceId: string,
    toWorkspaceId: string,
    toOrganizationId: string | null
  ) =>
    [
      ...qk.device(orgId, wsId, deviceId),
      "transfer-preview",
      toWorkspaceId,
      toOrganizationId,
    ] as const,
  deviceTransferOffers: (orgId: Id, wsId: Id, deviceId: string) =>
    [...qk.device(orgId, wsId, deviceId), "transfer-offers"] as const,
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

  // --- Models section (xorgate-models M4). Org-owned: a dataset, a job and a
  // registry entry have no workspace, so nothing here hangs off qk.ws.
  datasets: (orgId: Id) => [...qk.org(orgId), "datasets"] as const,
  dataset: (orgId: Id, datasetId: string) =>
    [...qk.org(orgId), "dataset", datasetId] as const,
  // Everything about one dataset EXTENDS its key, so invalidating
  // qk.dataset(...) refreshes its items, versions and imports in one call.
  datasetItems: (orgId: Id, datasetId: string, params: Record<string, unknown>) =>
    [...qk.dataset(orgId, datasetId), "items", params] as const,
  datasetItemAnnotations: (orgId: Id, datasetId: string, itemId: string) =>
    [...qk.dataset(orgId, datasetId), "annotations", itemId] as const,
  datasetVersions: (orgId: Id, datasetId: string) =>
    [...qk.dataset(orgId, datasetId), "versions"] as const,
  datasetVersion: (orgId: Id, datasetId: string, version: number) =>
    [...qk.dataset(orgId, datasetId), "version", version] as const,
  datasetImports: (orgId: Id, datasetId: string) =>
    [...qk.dataset(orgId, datasetId), "imports"] as const,
  trainingJobs: (orgId: Id, params: Record<string, unknown>) =>
    [...qk.org(orgId), "training-jobs", params] as const,
  trainingJob: (orgId: Id, jobId: string) =>
    [...qk.org(orgId), "training-job", jobId] as const,
  // Trained networks (the registry), NOT hardware SKUs (qk.deviceModels).
  registryModels: (orgId: Id, params: Record<string, unknown>) =>
    [...qk.org(orgId), "registry-models", params] as const,
  registryModel: (orgId: Id, modelId: string) =>
    [...qk.org(orgId), "registry-model", modelId] as const,
} as const
