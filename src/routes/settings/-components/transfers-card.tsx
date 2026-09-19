import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { SearchIcon } from "lucide-react"
import { toast } from "sonner"
import type { TransferOffer } from "@xorgate/sdk"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { DataTable, type DataTableColumn } from "@/components/data-table"
import { xg, xgMessage } from "@/lib/xorgate"
import {
  useInvalidateTransferOffers,
  useOrgTransferOffers,
  useTransferAftermath,
  useTransferOfferPreview,
} from "@/queries/transfers"
import { useWorkspaceStore } from "@/store/workspace"
import {
  formatWhen,
  Note,
  OfferStatusBadge,
  transferOutcomeNotes,
} from "@/routes/devices/-components/transfer-parts"

/**
 * Device transfers at the organization level: claiming a code somebody sent
 * you, and the history of codes this organization issued or accepted.
 *
 * **There is no inbox of incoming offers, and there cannot be one.** An offer
 * names no destination — not knowing the destination's organization id is the
 * entire reason the code exists — so a pending offer is discoverable only by
 * its code. `GET /transfer-offers` returns what this organization SENT plus
 * what it has ACCEPTED, tagged by `direction`; an offer somebody else made is
 * invisible here until it has been accepted. Verified live: with a pending
 * offer outstanding, the destination organization's list returns zero rows.
 *
 * So the entry point is a box you paste a code into, not a notification list.
 */
export function TransfersCard() {
  return (
    <div className="flex flex-col gap-4">
      <ClaimCodeCard />
      <OfferHistoryCard />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Claim a code
// ---------------------------------------------------------------------------

function ClaimCodeCard() {
  const navigate = useNavigate()
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const aftermath = useTransferAftermath()
  const invalidateOffers = useInvalidateTransferOffers()

  // The typed value and the looked-up value are separate: the query must fire
  // on a deliberate submit, not on every keystroke, because a half-typed code
  // is a 404 and a form that 404s while you type reads as broken.
  const [draft, setDraft] = useState("")
  const [code, setCode] = useState<string | null>(null)
  const [wsId, setWsId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const preview = useTransferOfferPreview(code)
  const offer = preview.data

  function lookup() {
    const trimmed = draft.trim()
    if (trimmed === "") return
    setWsId(null)
    setCode(trimmed)
  }

  async function accept() {
    if (code === null || wsId === null) return
    setBusy(true)
    try {
      const { device, transfer } = await xg().transferOffers.accept(code, {
        workspaceId: wsId,
      })
      aftermath(transfer)
      invalidateOffers(device.id)
      setCode(null)
      setDraft("")
      const notes = transferOutcomeNotes(transfer)
      toast.success(`${device.name ?? device.serial} is now yours`, {
        description:
          notes[0] ??
          "It carries all of its telemetry history and recorded footage.",
      })
      void navigate({ to: "/devices/$id", params: { id: device.id } })
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function decline() {
    if (code === null) return
    setBusy(true)
    try {
      await xg().transferOffers.decline(code)
      setCode(null)
      setDraft("")
      invalidateOffers()
      // Q3: the source sees this. Their offer row reads `declined` with a
      // resolved time rather than silently expiring in seven days.
      toast.success("Transfer declined. The sender can see that you declined.")
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const claimable = offer?.status === "pending"

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claim a device</CardTitle>
        <CardDescription>
          When another organization hands you a device, they send you a
          transfer code out of band — by email, chat, or on a purchase order.
          Paste it here to see what it is for, then accept or decline it.
          Nobody can send a device into your organization without you doing
          this, so there is nothing to watch for in the meantime.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-col gap-2 sm:max-w-xl"
          onSubmit={(e) => {
            e.preventDefault()
            lookup()
          }}
        >
          <Label htmlFor="transfer-code">Transfer code</Label>
          <div className="flex gap-2">
            <Input
              id="transfer-code"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Paste the code you were sent…"
              className="font-mono"
              disabled={busy}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={busy || draft.trim() === ""}
            >
              <SearchIcon />
              Look up
            </Button>
          </div>
        </form>

        {preview.isError ? (
          <Note tone="danger" className="sm:max-w-xl">
            <p>
              No transfer is waiting on that code. Check it for a typo — a code
              that has already been claimed, withdrawn or expired reads the same
              way as one that never existed.
            </p>
          </Note>
        ) : null}

        {preview.isPending && code !== null ? (
          <p className="text-xs text-muted-foreground">Looking it up…</p>
        ) : null}

        {offer ? (
          <div className="flex flex-col gap-3 rounded-md border border-border p-4 sm:max-w-xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">
                {offer.device?.name ?? "A device"}
              </span>
              {offer.device ? (
                <Badge variant="outline">{offer.device.model.name}</Badge>
              ) : null}
              <OfferStatusBadge status={offer.status} />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Offered by</dt>
                <dd className="font-medium">{offer.from.organizationName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Expires</dt>
                <dd className="tabular-nums">{formatWhen(offer.expiresAt)}</dd>
              </div>
              {offer.device ? (
                <div>
                  <dt className="text-muted-foreground">Model</dt>
                  <dd className="font-mono">{offer.device.model.sku}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-muted-foreground">Created</dt>
                <dd className="tabular-nums">{formatWhen(offer.createdAt)}</dd>
              </div>
            </dl>

            {/* Everything the recipient is allowed to know is above. There is
                deliberately no serial, no device id and no tenancy here: the
                code is a bearer token held by an organization not yet entitled
                to the device, and the API's own response is an allowlist. */}
            <Note tone="info">
              <p>
                Accepting brings the device into your organization together
                with all of its telemetry history and every recorded video
                segment. It does not have to be online — it adopts the change
                the next time it connects.
              </p>
            </Note>

            {offer.device === null ? (
              <Note tone="warn">
                <p>
                  The device behind this code no longer exists. Ask the sender
                  to issue a new one.
                </p>
              </Note>
            ) : null}

            {!claimable ? (
              <Note tone="warn">
                <p>
                  This offer is {offer.status} and can no longer be accepted.
                  Ask the sender for a new code.
                </p>
              </Note>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="claim-workspace">Destination workspace</Label>
                  <Select
                    value={wsId ?? ""}
                    onValueChange={setWsId}
                    disabled={busy}
                  >
                    <SelectTrigger id="claim-workspace" className="w-full">
                      <SelectValue placeholder="Choose a workspace…" />
                    </SelectTrigger>
                    <SelectContent>
                      {workspaces.map((ws) => (
                        <SelectItem key={ws.id} value={ws.id}>
                          {ws.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => void accept()}
                    disabled={busy || wsId === null}
                  >
                    {busy ? "Accepting…" : "Accept device"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void decline()}
                    disabled={busy}
                  >
                    Decline
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function OfferHistoryCard() {
  const offers = useOrgTransferOffers()
  const invalidateOffers = useInvalidateTransferOffers()
  const [cancelling, setCancelling] = useState<string | null>(null)

  async function cancel(offer: TransferOffer) {
    setCancelling(offer.code)
    try {
      await xg().transferOffers.cancel(offer.code)
      invalidateOffers(offer.deviceId)
      toast.success("Transfer offer withdrawn")
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setCancelling(null)
    }
  }

  const columns: DataTableColumn<TransferOffer>[] = [
    {
      id: "device",
      header: "Device",
      cellClassName: "font-medium",
      cell: (offer) => offer.deviceName ?? offer.deviceId.slice(0, 8),
    },
    {
      id: "direction",
      header: "Direction",
      cell: (offer) => (
        <Badge variant="outline">
          {offer.direction === "outgoing" ? "Sent" : "Received"}
        </Badge>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (offer) => <OfferStatusBadge status={offer.status} />,
    },
    {
      id: "code",
      header: "Code",
      cellClassName: "font-mono text-muted-foreground",
      // Only while it can still be used. A resolved code is dead, and printing
      // dead bearer tokens in a table nobody needs them from is pointless risk.
      cell: (offer) => (offer.status === "pending" ? offer.code : "—"),
    },
    {
      id: "expires",
      header: "Expires",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (offer) =>
        offer.resolvedAt
          ? `resolved ${formatWhen(offer.resolvedAt)}`
          : formatWhen(offer.expiresAt),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (offer) =>
        offer.status === "pending" && offer.direction === "outgoing" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={cancelling === offer.code}
            onClick={() => void cancel(offer)}
          >
            {cancelling === offer.code ? "Withdrawing…" : "Withdraw"}
          </Button>
        ) : null,
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transfer history</CardTitle>
        <CardDescription>
          Codes this organization issued, and devices it has accepted. A code
          somebody else issued does not appear here until you accept it — an
          offer names no destination, which is the whole reason it is a code.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          card={false}
          columns={columns}
          rows={offers.data ?? []}
          getRowKey={(offer) => offer.id}
          loading={offers.isPending}
          skeletonRows={3}
          empty={
            <p className="py-10 text-center text-sm text-muted-foreground">
              No device transfers yet.
            </p>
          }
        />
      </CardContent>
    </Card>
  )
}
