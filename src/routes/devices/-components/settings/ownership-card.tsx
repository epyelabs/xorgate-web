import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import type { Device, TransferResult } from "@xorgate/sdk"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { deviceAdoption } from "@/lib/device-tenancy"
import { useDevice } from "@/queries/devices"
import { xg, xgMessage } from "@/lib/xorgate"
import {
  useDeviceTransferOffers,
  useInvalidateTransferOffers,
  useTransferAftermath,
} from "@/queries/transfers"
import { useAuthStore } from "@/store/auth"
import { useWorkspaceStore } from "@/store/workspace"
import { TransferDeviceDialog } from "../transfer-device-dialog"
import {
  formatWhen,
  pendingOffer,
  transferOutcomeNotes,
} from "../transfer-parts"

/**
 * Where this device lives, and the way to move it.
 *
 * Deliberately NOT in the Danger zone. A same-organization transfer is
 * reversible in one click by anyone who can see both workspaces, and filing it
 * next to "permanently delete this device and its recordings" would overstate
 * it — so it gets its own card, in the same header-action idiom, directly above
 * the destructive one.
 */
export function OwnershipCard({ device: seed }: { device: Device }) {
  const navigate = useNavigate()
  // The Settings page holds its own local copy of the device — it has to, for
  // the optimistic save queue — and that copy is fetched once on mount, so a
  // transfer would leave this card naming the workspace the device just left.
  // Read the shared query instead, which the layout route already polls (so
  // this costs no extra request) and which `useTransferAftermath` invalidates.
  // The prop stays the seed, so the card paints in the first frame.
  const live = useDevice(seed.id).data
  const device = live ?? seed
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const organizations = useAuthStore((s) => s.organizations)
  const currentOrganizationId = useWorkspaceStore(
    (s) => s.currentOrganizationId
  )
  const aftermath = useTransferAftermath()
  const invalidateOffers = useInvalidateTransferOffers()
  const offers = useDeviceTransferOffers(device.id)
  const [open, setOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const deviceName = device.name ?? device.serial
  const workspaceName =
    workspaces.find((w) => w.id === device.workspaceId)?.name ??
    device.workspaceId
  const organizationName =
    organizations.find((o) => o.id === currentOrganizationId)?.name ?? "—"

  const adoption = deviceAdoption(device, currentOrganizationId)
  const offer = pendingOffer(offers.data)

  function handleTransferred({ transfer }: TransferResult) {
    setOpen(false)
    // Queries AND the live credential. The second half is the one that has no
    // visible symptom here: this console subscribes to both telemetry planes
    // with wildcards, so a viewer left on a stale scope looks perfectly
    // healthy from inside it while a workspace-scoped third party sees
    // nothing at all.
    aftermath(transfer)

    const leftTheOrganization =
      transfer.to.organizationId !== currentOrganizationId
    const notes = transferOutcomeNotes(transfer)

    if (leftTheOrganization) {
      // Reading the device would 404 from here — the API answers 404 rather
      // than 403 on purpose, since confirming another tenant's resource exists
      // is itself a leak. Leave before they hit it.
      toast.success(`${deviceName} transferred out of ${organizationName}`, {
        description:
          notes[0] ??
          "It no longer appears in this organization. The new owner can see it now.",
      })
      void navigate({ to: "/devices" })
      return
    }

    const destination =
      workspaces.find((w) => w.id === transfer.to.workspaceId)?.name ??
      "its new workspace"
    toast.success(`${deviceName} moved to ${destination}`, {
      description: notes[0],
    })
  }

  async function cancelOffer(code: string) {
    setCancelling(true)
    try {
      await xg().transferOffers.cancel(code)
      invalidateOffers(device.id)
      toast.success("Transfer offer cancelled")
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setCancelling(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Ownership
            {/* Three adoption states, and only one of them is worth a badge.
                `confirmed` needs no decoration; `unknown` means the agent
                predates the report and would be a permanent badge on every
                older device, which is noise, not information. */}
            {adoption === "pending" ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="cursor-default border-amber-500/50 font-normal text-amber-600 dark:text-amber-400"
                  >
                    pending on device
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  The move is complete in the cloud. This device is still
                  publishing under its previous workspace and will pick the
                  change up the next time it connects.
                </TooltipContent>
              </Tooltip>
            ) : null}
          </CardTitle>
          <CardDescription>
            This device belongs to{" "}
            <span className="font-medium text-foreground">{workspaceName}</span>{" "}
            in{" "}
            <span className="font-medium text-foreground">
              {organizationName}
            </span>
            . Moving it takes its telemetry history and recorded footage with
            it; the device itself is not touched and does not have to be online.
          </CardDescription>
          <CardAction>
            <Button variant="outline" onClick={() => setOpen(true)}>
              Transfer ownership
            </Button>
          </CardAction>
        </CardHeader>

        {offer !== null ? (
          <CardContent>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
              <Badge
                variant="outline"
                className="border-amber-500/50 text-amber-600 dark:text-amber-400"
              >
                Transfer pending
              </Badge>
              <span className="text-muted-foreground">
                A transfer code is outstanding — expires{" "}
                {formatWhen(offer.expiresAt)}. Anyone holding it can claim this
                device.
              </span>
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                {offer.code}
              </code>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                disabled={cancelling}
                onClick={() => void cancelOffer(offer.code)}
              >
                {cancelling ? "Cancelling…" : "Cancel offer"}
              </Button>
            </div>
          </CardContent>
        ) : null}
      </Card>

      <TransferDeviceDialog
        open={open}
        onOpenChange={setOpen}
        device={device}
        deviceName={deviceName}
        currentWorkspaceName={workspaceName}
        currentOrganizationName={organizationName}
        onTransferred={handleTransferred}
        onOfferChanged={() => invalidateOffers(device.id)}
      />
    </>
  )
}
