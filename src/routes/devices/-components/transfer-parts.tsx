import type { ReactNode } from "react"
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  InfoIcon,
  Loader2Icon,
} from "lucide-react"
import { toast } from "sonner"
import type {
  TransferOffer,
  TransferOfferStatus,
  TransferPreview,
  TransferSummary,
} from "@xorgate/sdk"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

export function formatWhen(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return dateTimeFormat.format(parsed)
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Muted panel, the same weight as the settings-tab callouts. */
export function Note({
  tone = "info",
  icon,
  children,
  className,
}: {
  tone?: "info" | "warn" | "danger"
  icon?: ReactNode
  children: ReactNode
  className?: string
}) {
  const glyph =
    icon ??
    (tone === "info" ? <InfoIcon /> : <AlertTriangleIcon />)
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        tone === "info" && "border-border bg-muted/40 text-muted-foreground",
        tone === "warn" &&
          "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400",
        tone === "danger" &&
          "border-destructive/40 bg-destructive/5 text-destructive",
        "[&_svg]:mt-px [&_svg]:size-3.5 [&_svg]:shrink-0",
        className
      )}
    >
      {glyph}
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  )
}

/** `from → to`, the one line that says what is about to happen. */
export function TenancyArrow({
  from,
  to,
  crossOrg,
}: {
  from: { workspaceName: string; organizationName: string }
  to: { workspaceName: string; organizationName: string }
  crossOrg: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">
        {from.workspaceName}
        {crossOrg ? (
          <span className="text-xs"> · {from.organizationName}</span>
        ) : null}
      </span>
      <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="font-medium text-foreground">
        {to.workspaceName}
        {crossOrg ? (
          <span className="text-xs font-normal text-muted-foreground">
            {" "}
            · {to.organizationName}
          </span>
        ) : null}
      </span>
      {crossOrg ? (
        <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
          different organization
        </Badge>
      ) : null}
    </div>
  )
}

/**
 * The dry run, rendered.
 *
 * Three rules this panel exists to keep:
 *
 *  - `carriesHistory` is always `true` and is here to be READ, not branched on.
 *    "Does our footage go with it?" is the question a customer actually asks,
 *    and across organizations the answer is a disclosure event, so it is stated
 *    first and in full rather than buried under a caveat.
 *  - Blockers are the API's own refusal, returned rather than thrown. The copy
 *    is the message the real call would have answered with; we do not rewrite
 *    it.
 *  - `warnings` are already written for display (the offline one especially —
 *    offline is a NORMAL success here, not a reason to stop). Rendered as-is.
 */
export function TransferPreviewPanel({
  preview,
  loading,
  error,
}: {
  preview: TransferPreview | undefined
  loading: boolean
  error: string | null
}) {
  if (error !== null) {
    return (
      <Note tone="danger">
        <p>{error}</p>
      </Note>
    )
  }
  if (loading || !preview) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  const {
    crossOrg,
    workflowAttachments,
    runningWorkflowRuns,
    openMediaSessions,
    staleSessionTokens,
    kvsChannels,
    blockers,
    warnings,
  } = preview

  return (
    <div className="flex flex-col gap-3">
      <TenancyArrow from={preview.from} to={preview.to} crossOrg={crossOrg} />

      {blockers.length > 0 ? (
        <Note tone="danger">
          <p className="font-medium">
            {blockers.length === 1
              ? "This transfer cannot proceed."
              : "This transfer cannot proceed:"}
          </p>
          <ul className="list-disc pl-4">
            {blockers.map((b) => (
              <li key={b.code}>{b.message}</li>
            ))}
          </ul>
        </Note>
      ) : null}

      {/* carriesHistory. Always true; always said out loud. */}
      <Note tone={crossOrg ? "warn" : "info"}>
        <p>
          <span className="font-medium">
            Everything the device has recorded travels with it.
          </span>{" "}
          All telemetry history and every recorded video segment move to{" "}
          {preview.to.workspaceName}. Nothing is purged, copied or left behind.
          {crossOrg ? (
            <>
              {" "}
              Because {preview.to.organizationName} is a different organization,
              that is a disclosure of this device&apos;s past data to it.
            </>
          ) : null}
        </p>
      </Note>

      <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        <li>
          The device is not touched. Its certificate and identity do not change
          and there is nothing to re-enrol — it adopts the new workspace the
          next time it connects.
        </li>
        {kvsChannels > 0 ? (
          <li>
            {plural(kvsChannels, "live-video channel")} are re-tagged. A viewer
            with a stream already open may have to reopen it.
          </li>
        ) : null}
        {workflowAttachments.length > 0 ? (
          <li className="text-amber-700 dark:text-amber-400">
            <span className="font-medium">
              {plural(workflowAttachments.length, "workflow attachment")} will
              be detached
            </span>{" "}
            — {workflowAttachments.map((a) => a.templateName).join(", ")}. The
            templates belong to {preview.from.organizationName} and the new
            owner cannot see them.
          </li>
        ) : null}
        {staleSessionTokens > 0 ? (
          <li>
            {plural(staleSessionTokens, "credential")} scoped to{" "}
            {preview.from.workspaceName} lose access to this device. They are
            not revoked.
          </li>
        ) : null}
        {runningWorkflowRuns > 0 ? (
          <li>
            {plural(runningWorkflowRuns, "workflow run")} in flight are left to
            finish under {preview.from.workspaceName}.
          </li>
        ) : null}
        {openMediaSessions > 0 ? (
          <li>
            {plural(openMediaSessions, "recording session")} still open keep
            uploading; the footage lands with the device.
          </li>
        ) : null}
      </ul>

      {warnings.map((w) => (
        <Note key={w} tone="info">
          <p>{w}</p>
        </Note>
      ))}
    </div>
  )
}

/**
 * What a COMPLETED transfer actually did — the honest read of a 200.
 *
 * A 200 is not uniformly clean and this is where that shows:
 * `scopeAttributes: "failed"` is a degraded success (moved and instructed, but
 * the broker was never told to allow it), and `adoption` has three values where
 * `pending` is normal and `unknown` means an agent too old to say. None of the
 * three is an error; none of them is silence either.
 *
 * `kvsChannelsRetagged` is deliberately NOT rendered as "N of this device's
 * cameras moved" — it counts rows repaired across both workspaces the transfer
 * touched, other devices' included, so it can exceed the preview's count.
 */
export function transferOutcomeNotes(transfer: TransferSummary): string[] {
  const notes: string[] = []
  if (transfer.scopeAttributes === "failed") {
    notes.push(
      "The device moved, but its broker permissions could not be updated. It falls back to the legacy telemetry plane — history and this console keep working, but a workspace-scoped credential sees nothing until the next settings save re-asserts them."
    )
  }
  if (transfer.adoption === "pending") {
    notes.push(
      "The device has not picked the change up yet. That is normal: the move is already complete in the cloud and the device adopts it the next time it connects."
    )
  }
  if (transfer.adoption === "unknown") {
    notes.push(
      "This device has never reported which workspace it is publishing to — its agent predates that report. The move is complete in the cloud; there is no way to confirm it from here."
    )
  }
  if (transfer.detachedWorkflowAttachments.length > 0) {
    notes.push(
      `Detached from ${transfer.detachedWorkflowAttachments.join(", ")}.`
    )
  }
  return [...notes, ...transfer.warnings]
}

export function TransferOutcome({ transfer }: { transfer: TransferSummary }) {
  const notes = transferOutcomeNotes(transfer)
  if (notes.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {notes.map((note, i) => (
        <Note
          key={i}
          tone={transfer.scopeAttributes === "failed" && i === 0 ? "warn" : "info"}
        >
          <p>{note}</p>
        </Note>
      ))}
    </div>
  )
}

const OFFER_STATUS_LABEL: Record<TransferOfferStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
}

export function OfferStatusBadge({ status }: { status: TransferOfferStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        status === "pending" &&
          "border-amber-500/50 text-amber-600 dark:text-amber-400",
        status === "accepted" &&
          "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
      )}
    >
      {OFFER_STATUS_LABEL[status]}
    </Badge>
  )
}

/** The code, monospaced, with copy-to-clipboard. */
export function OfferCode({
  code,
  copied,
  onCopy,
}: {
  code: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
        {code}
      </code>
      <Button type="button" variant="outline" size="sm" onClick={onCopy}>
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  )
}

export async function copyToClipboard(
  value: string,
  onDone: () => void
): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    onDone()
  } catch {
    toast.error("Failed to copy to clipboard")
  }
}

export function pendingOffer(
  offers: TransferOffer[] | undefined
): TransferOffer | null {
  return offers?.find((o) => o.status === "pending") ?? null
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 animate-spin" />
      {label}
    </div>
  )
}
