import { useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useLiveScope } from "@xorgate/react"
import type {
  TransferOffer,
  TransferOfferPreview,
  TransferOfferStatus,
  TransferPreview,
  TransferSummary,
} from "@xorgate/sdk"
import { xg } from "@/lib/xorgate"
import { qk } from "@/queries/keys"
import { useTenant } from "@/queries/tenant"

/**
 * The dry run behind the confirmation dialog.
 *
 * Blockers come back in the payload rather than as an exception, so a refused
 * transfer resolves as a normal result and the dialog explains it without ever
 * provoking the real call. Kept fresh at zero stale time: the answer depends on
 * a serial collision and a mid-transfer lock that another operator can create
 * between opening the dialog and confirming it.
 */
export function useTransferPreview({
  deviceId,
  toWorkspaceId,
  toOrganizationId = null,
  enabled = true,
}: {
  deviceId: string
  toWorkspaceId: string | null
  toOrganizationId?: string | null
  enabled?: boolean
}) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery<TransferPreview>({
    queryKey: qk.deviceTransferPreview(
      orgId,
      wsId,
      deviceId,
      toWorkspaceId ?? "",
      toOrganizationId
    ),
    queryFn: () =>
      xg().devices.previewTransfer(deviceId, {
        workspaceId: toWorkspaceId!,
        ...(toOrganizationId ? { organizationId: toOrganizationId } : {}),
      }),
    enabled: ready && enabled && toWorkspaceId !== null,
    staleTime: 0,
    retry: false,
  })
}

/** Every offer ever made for one device — the handover history, newest first. */
export function useDeviceTransferOffers(
  deviceId: string,
  { enabled = true }: { enabled?: boolean } = {}
) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery<TransferOffer[]>({
    queryKey: qk.deviceTransferOffers(orgId, wsId, deviceId),
    queryFn: () => xg().transferOffers.listForDevice(deviceId),
    enabled: ready && enabled,
    retry: false,
  })
}

/**
 * The organization's offers.
 *
 * **Not an inbox.** It returns what this organization SENT plus what it has
 * already ACCEPTED, tagged by `direction`; an offer someone else made is
 * invisible here until it has been accepted, because an offer names no
 * destination. A pending offer reaches its recipient out of band, as a code —
 * which is what the code-entry surface is for.
 */
export function useOrgTransferOffers({
  status,
}: { status?: TransferOfferStatus } = {}) {
  const { orgId } = useTenant()
  return useQuery<TransferOffer[]>({
    queryKey: qk.transferOffers(orgId, { status: status ?? null }),
    queryFn: () => xg().transferOffers.list(status ? { status } : {}),
    enabled: orgId !== null,
    retry: false,
  })
}

/**
 * The RECIPIENT's view of a pasted code. A deliberately thin allowlist — device
 * name, model, source organization — and a different type from `TransferOffer`.
 *
 * `retry: false` because the failure that matters here is a 404 on a typo, and
 * retrying it just makes the form feel broken.
 */
export function useTransferOfferPreview(code: string | null) {
  const { orgId } = useTenant()
  return useQuery<TransferOfferPreview>({
    queryKey: qk.transferOfferPreview(orgId, code ?? ""),
    queryFn: () => xg().transferOffers.get(code!),
    enabled: orgId !== null && code !== null && code !== "",
    staleTime: 0,
    retry: false,
  })
}

/**
 * Everything that has to happen after a device changes hands, in one call.
 *
 * Two halves, and the second is the one that is easy to forget:
 *
 *  - **Queries.** Both workspace subtrees, not just the active one: the device
 *    left one fleet and joined another, and `qk.ws` is the common prefix of the
 *    fleet list and every per-device key under it. The org-level offer lists go
 *    too, since an accept resolves one.
 *  - **The live plane.** A vended live credential encodes the OLD workspace and
 *    is cached for up to ~50 minutes. Without `invalidate()` an open telemetry
 *    or video pane keeps subscribing to a topic the device no longer publishes
 *    on and goes quietly blank — no error, no reconnect, just silence.
 *
 * That second failure is invisible in this console, which subscribes to both
 * telemetry planes with wildcards and renders a mis-scoped device perfectly
 * (README §1.5). So this is a deliberate call, not something anyone will catch
 * by eye here; the consumer it protects is a third party holding a
 * workspace-scoped credential.
 */
export function useTransferAftermath() {
  const { orgId } = useTenant()
  const queryClient = useQueryClient()
  const { invalidate: invalidateLiveScope } = useLiveScope()

  return useCallback(
    (transfer: Pick<TransferSummary, "from" | "to">) => {
      const workspaces = new Set([
        transfer.from.workspaceId,
        transfer.to.workspaceId,
      ])
      const organizations = new Set([
        transfer.from.organizationId,
        transfer.to.organizationId,
        ...(orgId ? [orgId] : []),
      ])
      for (const organizationId of organizations) {
        for (const workspaceId of workspaces) {
          void queryClient.invalidateQueries({
            queryKey: qk.ws(organizationId, workspaceId),
          })
        }
        // Offers, which live above the workspace. A prefix match, so both the
        // filtered and unfiltered lists go.
        void queryClient.invalidateQueries({
          queryKey: [...qk.org(organizationId), "transfer-offers"],
        })
      }
      invalidateLiveScope()
    },
    [queryClient, orgId, invalidateLiveScope]
  )
}

/** Refresh the offer lists alone — for create / cancel / decline, which move no device. */
export function useInvalidateTransferOffers() {
  const { orgId, wsId } = useTenant()
  const queryClient = useQueryClient()
  return useCallback(
    (deviceId?: string) => {
      void queryClient.invalidateQueries({
        queryKey: [...qk.org(orgId), "transfer-offers"],
      })
      if (deviceId) {
        void queryClient.invalidateQueries({
          queryKey: qk.deviceTransferOffers(orgId, wsId, deviceId),
        })
      }
    },
    [queryClient, orgId, wsId]
  )
}
