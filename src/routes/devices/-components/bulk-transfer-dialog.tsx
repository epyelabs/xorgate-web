import { useState } from "react"
import { CheckIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import type { BulkTransferItem, Device } from "@xorgate/sdk"
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
import { xg, xgMessage } from "@/lib/xorgate"
import { useTransferAftermath } from "@/queries/transfers"
import { useWorkspaceStore } from "@/store/workspace"
import { Note, plural, transferOutcomeNotes } from "./transfer-parts"

/**
 * Q5's bulk transfer: N devices, one destination workspace, same organization.
 *
 * **There is no batch endpoint and this dialog does not pretend there is one.**
 * `transferMany()` is a client-side loop over `POST /devices/{id}/transfer`,
 * deliberately sequential — each transfer publishes a retained MQTT message and
 * writes AWS IoT thing attributes, and firing N of those at once is a good way
 * to find the account's control-plane limits during an operation whose whole
 * design depends on two writes staying adjacent.
 *
 * So the result is **partial by construction**. It does not stop at the first
 * failure and there is nothing to roll back — a transfer that failed already
 * rolled itself back — which is why the outcome is rendered per device rather
 * than summarised into one toast. A serial collision in the destination is the
 * realistic failure, and it affects one device out of N.
 *
 * Same-organization only in v1: a cross-organization move needs the caller
 * authorized in both tenancies, which is one device and one handshake at a
 * time.
 */
export function BulkTransferDialog({
  open,
  onOpenChange,
  devices,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  devices: Device[]
  onDone: () => void
}) {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const aftermath = useTransferAftermath()
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<BulkTransferItem[] | null>(null)

  // Adjust-state-during-render rather than an effect (the idiom in
  // settings/index.tsx): reopening must start clean, and doing it in an effect
  // paints one frame of the previous run's results first.
  const [seenOpen, setSeenOpen] = useState(open)
  if (seenOpen !== open) {
    setSeenOpen(open)
    if (open) {
      setTarget(null)
      setResults(null)
    }
  }

  const names = new Map(devices.map((d) => [d.id, d.name ?? d.serial]))
  // Devices already in the destination would each come back SAME_WORKSPACE.
  // Counted, not silently dropped: an operator who selected 12 rows should be
  // told 3 of them are already there rather than watch 3 fail.
  const alreadyThere = devices.filter((d) => d.workspaceId === target)
  const movable = devices.filter((d) => d.workspaceId !== target)

  async function run() {
    if (target === null || movable.length === 0) return
    setBusy(true)
    try {
      const items = await xg().devices.transferMany(
        movable.map((d) => d.id),
        { workspaceId: target }
      )
      setResults(items)
      const ok = items.filter((i) => i.ok)
      // Once per distinct source→destination pair, not once per device: they
      // all share a destination and usually a source, and `aftermath` also
      // drops the live credential — doing that N times would mint N of them.
      const seen = new Set<string>()
      for (const item of ok) {
        if (!item.transfer) continue
        const pair = `${item.transfer.from.workspaceId}->${item.transfer.to.workspaceId}`
        if (seen.has(pair)) continue
        seen.add(pair)
        aftermath(item.transfer)
      }
      onDone()
      const failed = items.length - ok.length
      if (failed === 0) {
        toast.success(`${plural(ok.length, "device")} transferred`)
      } else if (ok.length === 0) {
        toast.error(`No devices were transferred — ${plural(failed, "failure")}`)
      } else {
        toast.warning(
          `${plural(ok.length, "device")} transferred, ${failed} failed`
        )
      }
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const destinationName =
    workspaces.find((w) => w.id === target)?.name ?? "the destination"

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Transfer {plural(devices.length, "device")}</DialogTitle>
          <DialogDescription>
            Move the selected devices to another workspace in this
            organization. Each one carries its telemetry history and recorded
            footage with it. Devices do not have to be online.
          </DialogDescription>
        </DialogHeader>

        {results === null ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="bulk-transfer-workspace">
                Destination workspace
              </Label>
              <Select
                value={target ?? undefined}
                onValueChange={setTarget}
                disabled={busy}
              >
                <SelectTrigger id="bulk-transfer-workspace" className="w-full">
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

            {target !== null && alreadyThere.length > 0 ? (
              <Note tone="info">
                <p>
                  {plural(alreadyThere.length, "selected device")} already in{" "}
                  {destinationName}
                  {alreadyThere.length === 1 ? " is" : " are"} skipped.
                </p>
              </Note>
            ) : null}

            {target !== null ? (
              <Note tone="info">
                <p>
                  Devices are transferred one at a time and the run does not
                  stop at a failure, so the result can be partial. Nothing is
                  rolled back afterwards — a transfer that failed already
                  undid itself, and the ones that succeeded stand.
                </p>
              </Note>
            ) : null}
          </div>
        ) : (
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto text-xs">
            {results.map((item) => (
              <li
                key={item.deviceId}
                className="flex items-start gap-2 rounded-md border border-border px-2 py-1.5"
              >
                {item.ok ? (
                  <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                ) : (
                  <XIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                )}
                <div className="min-w-0">
                  <span className="font-medium">
                    {names.get(item.deviceId) ?? item.deviceId}
                  </span>
                  {item.ok ? (
                    <span className="text-muted-foreground">
                      {" "}
                      — moved to {destinationName}
                      {item.transfer
                        ? transferOutcomeNotes(item.transfer)
                            .slice(0, 1)
                            .map((n) => `. ${n}`)
                            .join("")
                        : ""}
                    </span>
                  ) : (
                    <span className="text-destructive">
                      {" "}
                      — {item.error?.message ?? "transfer failed"}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              {results === null ? "Cancel" : "Close"}
            </Button>
          </DialogClose>
          {results === null ? (
            <Button
              onClick={() => void run()}
              disabled={busy || target === null || movable.length === 0}
            >
              {busy
                ? `Transferring ${movable.length}…`
                : `Transfer ${plural(movable.length, "device")}`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
