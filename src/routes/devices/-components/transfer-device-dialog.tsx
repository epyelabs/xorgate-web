import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import type {
  Device,
  MembershipRole,
  TransferOffer,
  TransferResult,
} from "@xorgate/sdk"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { xg, xgForOrg, xgMessage } from "@/lib/xorgate"
import { useAuthStore } from "@/store/auth"
import { useWorkspaceStore } from "@/store/workspace"
import {
  useDeviceTransferOffers,
  useInvalidateTransferOffers,
  useTransferPreview,
} from "@/queries/transfers"
import {
  copyToClipboard,
  formatWhen,
  Note,
  OfferCode,
  pendingOffer,
  TransferPreviewPanel,
} from "./transfer-parts"

const CAN_TRANSFER: MembershipRole[] = ["owner", "admin"]

/**
 * Moving a device to another workspace, or to another organization.
 *
 * Modelled on `delete-device-dialog.tsx` — plain Dialog, a busy flag that
 * blocks `onOpenChange` while a write is in flight, and no type-to-confirm.
 * A transfer is not destructive the way a delete is: a same-organization move
 * is reversible in one click by anyone who can see both workspaces.
 *
 * Two flows behind two tabs, because they are genuinely different operations:
 *
 *  - **This organization** — one write, immediate. Q5's bulk variant lives on
 *    the devices list.
 *  - **Another organization** — either the both-membership fast path (you
 *    administer both ends, so the round trip is pointless), or an offer code
 *    handed over out of band. `auth.organizationId` resolves to exactly one
 *    organization per request, so a caller can never be authorized in the
 *    destination on the same call; the code is what bridges that.
 */
export function TransferDeviceDialog({
  open,
  onOpenChange,
  device,
  deviceName,
  currentWorkspaceName,
  currentOrganizationName,
  onTransferred,
  onOfferChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  device: Device
  deviceName: string
  currentWorkspaceName: string
  currentOrganizationName: string
  /** Fires after a completed transfer. The caller owns invalidation and navigation. */
  onTransferred: (result: TransferResult) => void
  /** Fires after an offer is created or cancelled — nothing moved, but the card changes. */
  onOfferChanged?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState("same-org")

  // Re-seed on every open: a dialog reopened after a transfer must not still be
  // pointing at the workspace the device now lives in. Adjusted during render
  // rather than in an effect, so the reopened dialog never paints one frame of
  // the previous tab.
  const [seenOpen, setSeenOpen] = useState(open)
  if (seenOpen !== open) {
    setSeenOpen(open)
    if (open) setTab("same-org")
  }

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Transfer ownership</DialogTitle>
          <DialogDescription>
            Move <span className="font-medium text-foreground">{deviceName}</span>{" "}
            to another workspace, or hand it to another organization. The device
            itself is not touched and does not have to be online.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <TabsList className="w-full">
            <TabsTrigger value="same-org" disabled={busy} className="flex-1">
              This organization
            </TabsTrigger>
            <TabsTrigger value="cross-org" disabled={busy} className="flex-1">
              Another organization
            </TabsTrigger>
          </TabsList>

          <TabsContent value="same-org">
            <SameOrgTab
              device={device}
              currentWorkspaceName={currentWorkspaceName}
              busy={busy}
              setBusy={setBusy}
              onTransferred={onTransferred}
            />
          </TabsContent>

          <TabsContent value="cross-org">
            <CrossOrgTab
              device={device}
              deviceName={deviceName}
              currentOrganizationName={currentOrganizationName}
              busy={busy}
              setBusy={setBusy}
              onTransferred={onTransferred}
              onOfferChanged={onOfferChanged}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// This organization
// ---------------------------------------------------------------------------

function SameOrgTab({
  device,
  currentWorkspaceName,
  busy,
  setBusy,
  onTransferred,
}: {
  device: Device
  currentWorkspaceName: string
  busy: boolean
  setBusy: (busy: boolean) => void
  onTransferred: (result: TransferResult) => void
}) {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const [target, setTarget] = useState<string | null>(null)

  const preview = useTransferPreview({
    deviceId: device.id,
    toWorkspaceId: target,
  })

  const blocked = (preview.data?.blockers.length ?? 0) > 0
  const canConfirm =
    target !== null && !preview.isPending && !preview.isError && !blocked

  async function confirm() {
    if (target === null) return
    setBusy(true)
    try {
      const result = await xg().devices.transfer(device.id, {
        workspaceId: target,
      })
      onTransferred(result)
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="transfer-workspace">Destination workspace</Label>
        <Select
          value={target ?? undefined}
          onValueChange={setTarget}
          disabled={busy}
        >
          <SelectTrigger id="transfer-workspace" className="w-full">
            <SelectValue placeholder="Choose a workspace…" />
          </SelectTrigger>
          <SelectContent>
            {workspaces.map((ws) => (
              <SelectItem
                key={ws.id}
                value={ws.id}
                disabled={ws.id === device.workspaceId}
              >
                {ws.name}
                {ws.id === device.workspaceId ? " (current)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {workspaces.length < 2 ? (
          <p className="text-xs text-muted-foreground">
            {currentWorkspaceName} is the only workspace in this organization.
            Create another one, or use the Another organization tab.
          </p>
        ) : null}
      </div>

      {target !== null ? (
        <TransferPreviewPanel
          preview={preview.data}
          loading={preview.isPending}
          error={preview.isError ? xgMessage(preview.error) : null}
        />
      ) : null}

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" disabled={busy}>
            Cancel
          </Button>
        </DialogClose>
        <Button onClick={confirm} disabled={!canConfirm || busy}>
          {busy ? "Transferring…" : "Transfer device"}
        </Button>
      </DialogFooter>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Another organization
// ---------------------------------------------------------------------------

function CrossOrgTab({
  device,
  deviceName,
  currentOrganizationName,
  busy,
  setBusy,
  onTransferred,
  onOfferChanged,
}: {
  device: Device
  deviceName: string
  currentOrganizationName: string
  busy: boolean
  setBusy: (busy: boolean) => void
  onTransferred: (result: TransferResult) => void
  onOfferChanged?: () => void
}) {
  const organizations = useAuthStore((s) => s.organizations)
  const memberships = useAuthStore((s) => s.memberships)
  const currentOrganizationId = useWorkspaceStore(
    (s) => s.currentOrganizationId
  )

  // The both-membership fast path is only offered where it would actually
  // work: owner or admin in the destination, as a USER. An API key is bound to
  // one organization and the API refuses it on this path with a 403.
  const fastPathOrgs = useMemo(
    () =>
      organizations.filter(
        (org) =>
          org.id !== currentOrganizationId &&
          CAN_TRANSFER.includes(
            memberships.find((m) => m.organizationId === org.id)?.role ??
              ("viewer" as MembershipRole)
          )
      ),
    [organizations, memberships, currentOrganizationId]
  )

  return (
    <div className="flex flex-col gap-4">
      {fastPathOrgs.length > 0 ? (
        <>
          <FastPathSection
            device={device}
            organizations={fastPathOrgs}
            busy={busy}
            setBusy={setBusy}
            onTransferred={onTransferred}
          />
          <Separator />
          <p className="text-xs font-medium text-muted-foreground">
            Or hand it to an organization you are not a member of
          </p>
        </>
      ) : null}

      <OfferSection
        device={device}
        deviceName={deviceName}
        currentOrganizationName={currentOrganizationName}
        busy={busy}
        setBusy={setBusy}
        onOfferChanged={onOfferChanged}
      />
    </div>
  )
}

/**
 * Q1's fast path: you administer both ends, so there is nobody to hand a code
 * to. One request, same engine, same audit row.
 *
 * The destination organization's workspaces come from a client pinned to that
 * organization — `xg()` speaks only for the one the switcher shows.
 */
function FastPathSection({
  device,
  organizations,
  busy,
  setBusy,
  onTransferred,
}: {
  device: Device
  organizations: { id: string; name: string }[]
  busy: boolean
  setBusy: (busy: boolean) => void
  onTransferred: (result: TransferResult) => void
}) {
  const [orgId, setOrgId] = useState<string | null>(null)
  const [wsId, setWsId] = useState<string | null>(null)

  const destWorkspaces = useQuery({
    queryKey: ["transfer-destination-workspaces", orgId],
    queryFn: () => xgForOrg(orgId!).workspaces.list(),
    enabled: orgId !== null,
    retry: false,
  })

  const preview = useTransferPreview({
    deviceId: device.id,
    toWorkspaceId: wsId,
    toOrganizationId: orgId,
  })

  const blocked = (preview.data?.blockers.length ?? 0) > 0
  const canConfirm =
    orgId !== null &&
    wsId !== null &&
    !preview.isPending &&
    !preview.isError &&
    !blocked

  async function confirm() {
    if (orgId === null || wsId === null) return
    setBusy(true)
    try {
      const result = await xg().devices.transfer(device.id, {
        workspaceId: wsId,
        organizationId: orgId,
      })
      onTransferred(result)
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Note tone="info">
        <p>
          You administer{" "}
          {organizations.length === 1
            ? organizations[0].name
            : `${organizations.length} other organizations`}
          , so this device can move straight there — no code to hand over.
        </p>
      </Note>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="transfer-dest-org">Destination organization</Label>
          <Select
            value={orgId ?? undefined}
            onValueChange={(value) => {
              setOrgId(value)
              setWsId(null)
            }}
            disabled={busy}
          >
            <SelectTrigger id="transfer-dest-org" className="w-full">
              <SelectValue placeholder="Choose an organization…" />
            </SelectTrigger>
            <SelectContent>
              {organizations.map((org) => (
                <SelectItem key={org.id} value={org.id}>
                  {org.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="transfer-dest-ws">Destination workspace</Label>
          <Select
            value={wsId ?? undefined}
            onValueChange={setWsId}
            disabled={busy || orgId === null || destWorkspaces.isPending}
          >
            <SelectTrigger id="transfer-dest-ws" className="w-full">
              <SelectValue
                placeholder={
                  orgId === null
                    ? "Pick an organization first"
                    : destWorkspaces.isPending
                      ? "Loading…"
                      : "Choose a workspace…"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {(destWorkspaces.data ?? []).map((ws) => (
                <SelectItem key={ws.id} value={ws.id}>
                  {ws.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {destWorkspaces.isError ? (
        <Note tone="danger">
          <p>{xgMessage(destWorkspaces.error)}</p>
        </Note>
      ) : null}

      {wsId !== null ? (
        <TransferPreviewPanel
          preview={preview.data}
          loading={preview.isPending}
          error={preview.isError ? xgMessage(preview.error) : null}
        />
      ) : null}

      <Button
        className="self-end"
        onClick={confirm}
        disabled={!canConfirm || busy}
      >
        {busy ? "Transferring…" : "Transfer device"}
      </Button>
    </div>
  )
}

/**
 * The handshake. The source mints a code with a seven-day expiry and sends it
 * out of band; the destination pastes it into their own Settings → Transfers.
 *
 * **At most one open offer per device**, enforced by a partial unique index, so
 * reopening this dialog hands back the SAME code rather than burning a second
 * claimable one. `reused` is how the SDK says which happened (201 vs 200 with
 * byte-identical bodies) — worth a word in the UI, because an operator who
 * clicks twice should be told the code they already sent is still the code.
 */
function OfferSection({
  device,
  deviceName,
  currentOrganizationName,
  busy,
  setBusy,
  onOfferChanged,
}: {
  device: Device
  deviceName: string
  currentOrganizationName: string
  busy: boolean
  setBusy: (busy: boolean) => void
  onOfferChanged?: () => void
}) {
  const offers = useDeviceTransferOffers(device.id)
  const invalidateOffers = useInvalidateTransferOffers()
  const [copied, setCopied] = useState(false)
  const [willDetach, setWillDetach] = useState<string[] | null>(null)

  const open = pendingOffer(offers.data)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function create() {
    setBusy(true)
    try {
      const { offer, willDetachWorkflowAttachments, reused } =
        await xg().transferOffers.create(device.id)
      setWillDetach(willDetachWorkflowAttachments)
      invalidateOffers(device.id)
      onOfferChanged?.()
      toast.success(
        reused
          ? "This device already had an open offer — here is the same code."
          : `Transfer code created. It expires ${formatWhen(offer.expiresAt)}.`
      )
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function cancel(offer: TransferOffer) {
    setBusy(true)
    try {
      await xg().transferOffers.cancel(offer.code)
      setWillDetach(null)
      invalidateOffers(device.id)
      onOfferChanged?.()
      toast.success("Transfer offer cancelled")
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        A request can only be authorized in one organization at a time, so a
        handover to an organization you are not a member of goes through a code.
        You create it here and send it to them however you like — email, a chat
        message, a purchase order. They paste it into their own{" "}
        <span className="font-medium text-foreground">
          Settings → Transfers
        </span>{" "}
        and accept or decline it. {currentOrganizationName} keeps the device
        until they do, and can withdraw the code at any time.
      </p>

      <Note tone="warn">
        <p>
          <span className="font-medium">
            All of {deviceName}&apos;s telemetry history and recorded footage go
            with it.
          </span>{" "}
          Nothing is purged and nothing is kept behind, so accepting this code
          discloses the device&apos;s past data to whoever holds it.
        </p>
      </Note>

      {willDetach !== null && willDetach.length > 0 ? (
        <Note tone="warn">
          <p>
            If another organization accepts, this device is detached from{" "}
            {willDetach.join(", ")}. Those templates stay with{" "}
            {currentOrganizationName}.
          </p>
        </Note>
      ) : null}

      {open !== null ? (
        <div className="flex flex-col gap-2">
          <Label>Transfer code</Label>
          <OfferCode
            code={open.code}
            copied={copied}
            onCopy={() => void copyToClipboard(open.code, () => setCopied(true))}
          />
          <p className="text-xs text-muted-foreground">
            Expires {formatWhen(open.expiresAt)}. Anyone holding this code can
            claim the device, so send it the way you would send a password.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => void cancel(open)}
            disabled={busy}
          >
            Cancel offer
          </Button>
        </div>
      ) : (
        <Button
          className="self-start"
          onClick={() => void create()}
          disabled={busy || offers.isPending}
        >
          {busy ? "Creating…" : "Create transfer code"}
        </Button>
      )}
    </div>
  )
}
