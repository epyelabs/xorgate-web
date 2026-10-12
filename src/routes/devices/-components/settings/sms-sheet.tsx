import { useEffect, useRef, useState } from "react"
import {
  AlertTriangleIcon,
  CloudOffIcon,
  MessageSquareTextIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"
import type { Device, MembershipRole } from "@xorgate/sdk"
import { DestroyDialog } from "@/components/destroy-dialog"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  SMS_DEVICE_OFFLINE,
  SMS_INSUFFICIENT_ROLE,
  SMS_UNSUPPORTED_AGENT,
  smsErrorCode,
  type SmsMessage,
  type SmsRead,
  type SmsReadAction,
} from "@/lib/device-sms-api"
import {
  DEFAULT_SMS_LIMIT,
  SMS_CLEAR_AGENT_REASON,
  SMS_CLEAR_CAPABILITY,
  SMS_CLEAR_ROLE_REASON,
  SMS_LIMITS,
  isSmsClear,
  isSmsReadPending,
  parseSmsLimit,
  smsCapability,
  smsClearConfirmText,
  smsClearGate,
  smsClearedToast,
  smsDisplayedRead,
  smsFullStoreWarnings,
  smsReadFailureMessage,
  smsSenderLabel,
  smsAgo,
  smsShowingLabel,
  smsStorageSummary,
  smsTags,
  sortSmsMessages,
  type SmsLimit,
} from "@/lib/device-sms"
import { formatDateTime } from "@/lib/format-time"
import { useCurrentRole } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { xgMessage } from "@/lib/xorgate"
import {
  useClearSms,
  useLatestSmsRead,
  useSmsRead,
  useStartSmsRead,
} from "@/queries/device-sms"
import { useLiveDeviceStatus } from "@/store/presence"

/**
 * The SIM card's Messages button and sheet (plans/device-sms-inbox §4).
 *
 * On demand only: opening the sheet shows the stored copy (the device's latest
 * successful read, kept by the cloud) and, when the device is online, asks it
 * for a fresh one in the background. Closing drops the in-flight read, so
 * nothing polls while the sheet is shut.
 *
 * Who sees it: every role (owner decision, §9 Q1). Gating: hidden without a
 * SIM block (the caller decides that); disabled only when the agent reported
 * itself and lacks `sms.read`. Such an agent cannot have produced a stored
 * read, so there is nothing to show. A device that never reported an agent
 * block stays clickable: the stored read is the authority there, and a read
 * request against an old agent is a clean 409 the sheet explains.
 *
 * Online-ness uses the live presence overlay (the same one the device header
 * shows), which is a cheap store read. The API gates reads on the REST status,
 * so a 409 DEVICE_OFFLINE from a device the overlay calls online is shown as
 * offline rather than as an error.
 *
 * "Clear all" (plans/device-sms-clear): owner and admin only, by an explicit
 * role check (`useHasPermission` fails open while memberships load, which is
 * wrong for a destructive button). Everyone else sees it disabled with the
 * reason. A clear is a row like a read: it goes into the same `readId` and
 * the same poll, and on `ok` its (empty) sweep becomes the stored copy.
 *
 * PRIVACY (contract §6): never log message text or senders.
 */

const LIMIT_STORAGE_KEY = "xorgate.smsInbox.limit"

function loadLimit(): SmsLimit {
  try {
    return parseSmsLimit(localStorage.getItem(LIMIT_STORAGE_KEY))
  } catch {
    return DEFAULT_SMS_LIMIT
  }
}

function saveLimit(limit: SmsLimit): void {
  try {
    localStorage.setItem(LIMIT_STORAGE_KEY, String(limit))
  } catch {
    // storage unavailable (private mode/quota): the choice lasts this session
  }
}

/** "Sep 30, 14:02", for the offline banner. */
function shortDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** Re-render every `ms` while `active`, so "Read 12s ago" keeps counting. */
function useNow(active: boolean, ms = 10_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    // The component outlives the sheet, so catch up at once on (re)opening.
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const t = setInterval(tick, ms)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [active, ms])
  return now
}

export function SmsInboxButton({ device }: { device: Device }) {
  const live = useLiveDeviceStatus(device) ?? device
  const online = live.status === "online"
  const capability = smsCapability(device)
  const clearCapability = smsCapability(device, SMS_CLEAR_CAPABILITY)
  const role = useCurrentRole()

  const [open, setOpen] = useState(false)
  const [limit, setLimit] = useState<SmsLimit>(loadLimit)
  const [readId, setReadId] = useState<string | null>(null)
  // A start that resolves after the sheet closed must not resurrect polling.
  const openRef = useRef(false)

  const start = useStartSmsRead(device.id)
  const clear = useClearSms(device.id)
  // Which request the sheet last made, so a 409/403 and the pending copy
  // speak about the right one.
  const [action, setAction] = useState<SmsReadAction>("read")
  const canAsk = online && capability !== "no"

  function startRead(n: SmsLimit) {
    setAction("read")
    clear.reset()
    start.mutate(n, {
      onSuccess: (read) => {
        if (openRef.current) setReadId(read.id)
      },
    })
  }

  /** Never throws: a failed POST stays in `clear.error` for the sheet. */
  async function startClear(): Promise<void> {
    setAction("clear")
    start.reset()
    try {
      const read = await clear.mutateAsync(limit)
      if (openRef.current) setReadId(read.id)
    } catch {
      // rendered as the sheet's notice
    }
  }

  function onOpenChange(next: boolean) {
    openRef.current = next
    setOpen(next)
    if (!next) {
      setReadId(null)
      start.reset()
      clear.reset()
      setAction("read")
      return
    }
    if (canAsk) startRead(limit)
  }

  function onLimitChange(n: SmsLimit) {
    setLimit(n)
    saveLimit(n)
    if (canAsk) startRead(n)
  }

  const disabled = capability === "no"

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* The span keeps the tooltip alive on a disabled button, which
              swallows pointer events. */}
          <span className="inline-flex">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Messages"
              disabled={disabled}
              onClick={() => onOpenChange(true)}
              data-testid="sms-inbox-button"
            >
              <MessageSquareTextIcon />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {disabled ? "Update the device agent to read messages" : "Messages"}
        </TooltipContent>
      </Tooltip>

      <SmsSheet
        deviceId={device.id}
        open={open}
        onOpenChange={onOpenChange}
        online={online}
        limit={limit}
        onLimitChange={onLimitChange}
        readId={readId}
        action={action}
        starting={start.isPending || clear.isPending}
        startError={action === "clear" ? clear.error : start.error}
        onRefresh={() => startRead(limit)}
        role={role}
        clearCapability={clearCapability}
        onClear={startClear}
      />
    </>
  )
}

function SmsSheet({
  deviceId,
  open,
  onOpenChange,
  online,
  limit,
  onLimitChange,
  readId,
  action,
  starting,
  startError,
  onRefresh,
  role,
  clearCapability,
  onClear,
}: {
  deviceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  online: boolean
  limit: SmsLimit
  onLimitChange: (limit: SmsLimit) => void
  readId: string | null
  action: SmsReadAction
  starting: boolean
  startError: Error | null
  onRefresh: () => void
  role: MembershipRole | null
  clearCapability: "yes" | "no" | "unknown"
  onClear: () => Promise<void>
}) {
  const latestQ = useLatestSmsRead(deviceId, open)
  const readQ = useSmsRead(deviceId, readId)
  const now = useNow(open)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const current = readQ.data
  const stored = smsDisplayedRead(latestQ.data, current)
  const reading = starting || isSmsReadPending(current)
  // In flight, and what is in flight is a clear: the old list is about to
  // be wrong, so it gives way to the pending rows.
  const clearing = reading && (action === "clear" || isSmsClear(current))

  const startCode = smsErrorCode(startError)
  const offline = !online || startCode === SMS_DEVICE_OFFLINE
  const unsupported = startCode === SMS_UNSUPPORTED_AGENT
  // The controls ask the device; there is nothing to ask when it cannot answer.
  // A clear refused for an old agent says nothing about reads.
  const controlsDisabled = offline || (unsupported && action === "read")

  const clearGate = smsClearGate({
    role,
    capability: unsupported && action === "clear" ? "no" : clearCapability,
    online: !offline,
    busy: reading,
  })

  // A clear that lands `ok` says how much it deleted. The row id is fresh per
  // request and the sheet outlives its openings, so each clear toasts once.
  const toastedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!current || current.status !== "ok" || !isSmsClear(current)) return
    if (toastedRef.current === current.id) return
    toastedRef.current = current.id
    toast.success(smsClearedToast(current.result?.cleared))
  }, [current])

  const failure = current ? smsReadFailureMessage(current) : null
  const canRetry =
    current?.status === "expired" ||
    current?.errorCode === "modem_busy" ||
    current?.errorCode === "error"

  // Inline notices above the list. The stored list stays below every one of
  // them: a failed refresh does not make the last good read wrong.
  let notice: { text: string; retry: boolean } | null = null
  if (startCode === SMS_INSUFFICIENT_ROLE) {
    notice = { text: `${SMS_CLEAR_ROLE_REASON}.`, retry: false }
  } else if (unsupported) {
    notice = {
      text:
        action === "clear"
          ? `${SMS_CLEAR_AGENT_REASON}.`
          : "Update the device agent to read messages.",
      retry: false,
    }
  } else if (startError && startCode !== SMS_DEVICE_OFFLINE) {
    notice = { text: xgMessage(startError), retry: true }
  } else if (readQ.error) {
    notice = { text: xgMessage(readQ.error), retry: true }
  } else if (failure !== null && !reading) {
    notice = { text: failure, retry: canRetry }
  }
  // "Try again" repeats what failed. A clear goes back through the confirm.
  const retryClear = action === "clear" || isSmsClear(current)
  const retryAllowed = retryClear ? clearGate.allowed : !controlsDisabled
  const onRetry = retryClear ? () => setConfirmOpen(true) : onRefresh

  const clearAll = (where: "header" | "footer") => (
    <ClearAllButton
      gate={clearGate}
      onClick={() => setConfirmOpen(true)}
      where={where}
    />
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-md"
        data-testid="sms-sheet"
      >
        <SheetHeader className="gap-1 border-b border-border pb-3">
          <SheetTitle className="pr-8">Messages</SheetTitle>
          <SheetDescription>
            Read from the SIM on demand. Xorgate keeps only the latest read.
          </SheetDescription>
          <div className="mt-2 flex items-center gap-2">
            <Select
              value={String(limit)}
              onValueChange={(v) => onLimitChange(parseSmsLimit(v))}
              disabled={controlsDisabled}
            >
              <SelectTrigger
                className="w-auto"
                aria-label="How many messages to read"
                data-testid="sms-limit"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SMS_LIMITS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    Newest {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon-sm"
              title={reading ? "Reading from the device" : "Read again from the device"}
              aria-label="Read messages again"
              disabled={controlsDisabled || reading}
              onClick={onRefresh}
              data-testid="sms-refresh"
            >
              <RefreshCwIcon className={cn(reading && "animate-spin")} />
            </Button>
            <div className="ml-auto">{clearAll("header")}</div>
          </div>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-4">
          {offline && stored ? (
            <Banner icon={<CloudOffIcon />} testId="sms-offline-banner">
              Device offline. Showing messages read{" "}
              {shortDateTime(stored.completedAt ?? stored.createdAt)}. They may
              be out of date.
            </Banner>
          ) : null}

          {notice !== null ? (
            <Banner
              icon={<AlertTriangleIcon />}
              tone="warn"
              testId="sms-notice"
              action={
                notice.retry && retryAllowed ? (
                  <Button variant="outline" size="xs" onClick={onRetry}>
                    Try again
                  </Button>
                ) : null
              }
            >
              {notice.text}
            </Banner>
          ) : null}

          {clearing ? (
            <LoadingRows asking label="Clearing messages…" />
          ) : stored ? (
            <MessageList read={stored} now={now} />
          ) : latestQ.isPending || reading ? (
            <LoadingRows asking={reading} label="Asking the device…" />
          ) : latestQ.error ? (
            <Banner
              icon={<AlertTriangleIcon />}
              tone="warn"
              action={
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => void latestQ.refetch()}
                >
                  Try again
                </Button>
              }
            >
              {xgMessage(latestQ.error)}
            </Banner>
          ) : offline ? (
            <Empty className="py-12" data-testid="sms-never-read">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageSquareTextIcon />
                </EmptyMedia>
                <EmptyTitle>No messages read yet</EmptyTitle>
                <EmptyDescription>
                  This device's messages haven't been read yet. Open this
                  again when it's online.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
        </div>

        {stored?.result && !clearing ? (
          <SheetFooterInfo
            read={stored}
            now={now}
            clearAction={clearAll("footer")}
          />
        ) : null}
      </SheetContent>

      <DestroyDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Clear all messages?"
        description={smsClearConfirmText(stored?.result?.total ?? null)}
        warning={
          <span className="font-medium text-foreground">
            This can't be undone.
          </span>
        }
        confirmLabel="Clear all"
        pendingLabel="Clearing…"
        confirmDisabled={!clearGate.allowed}
        onConfirm={async () => {
          await onClear()
          setConfirmOpen(false)
        }}
      />
    </Sheet>
  )
}

/**
 * "Clear all", in the header (labelled) and beside the full-store warning
 * (compact). Disabled with the reason as its tooltip; the span keeps the
 * tooltip alive on a disabled button, which swallows pointer events.
 */
function ClearAllButton({
  gate,
  onClick,
  where,
}: {
  gate: ReturnType<typeof smsClearGate>
  onClick: () => void
  where: "header" | "footer"
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            variant="destructive"
            size={where === "header" ? "sm" : "xs"}
            disabled={!gate.allowed}
            onClick={onClick}
            data-testid={`sms-clear-${where}`}
          >
            {where === "header" ? <Trash2Icon data-icon="inline-start" /> : null}
            Clear all
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {gate.reason ?? "Delete every message on the SIM and modem"}
      </TooltipContent>
    </Tooltip>
  )
}

function Banner({
  icon,
  tone = "muted",
  action,
  testId,
  children,
}: {
  icon: React.ReactNode
  tone?: "muted" | "warn"
  action?: React.ReactNode
  testId?: string
  children: React.ReactNode
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        "[&>svg]:mt-px [&>svg]:size-3.5 [&>svg]:shrink-0",
        tone === "warn"
          ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
          : "border-border bg-muted/40 text-muted-foreground"
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  )
}

function LoadingRows({ asking, label }: { asking: boolean; label: string }) {
  return (
    <div className="flex flex-col gap-3" data-testid="sms-loading">
      {asking ? <p className="text-xs text-muted-foreground">{label}</p> : null}
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-1.5 rounded-md border px-3 py-2.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}

function MessageList({ read, now }: { read: SmsRead; now: number }) {
  const messages = sortSmsMessages(read.result?.messages ?? [])
  if (messages.length === 0) {
    return (
      <Empty className="py-12" data-testid="sms-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageSquareTextIcon />
          </EmptyMedia>
          <EmptyTitle>No messages on this SIM</EmptyTitle>
          <EmptyDescription>
            Neither the SIM nor the modem holds any messages.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <ul className="flex flex-col gap-2" data-testid="sms-list">
      {messages.map((m) => (
        <MessageRow key={m.id} message={m} now={now} />
      ))}
    </ul>
  )
}

function MessageRow({ message: m, now }: { message: SmsMessage; now: number }) {
  return (
    <li className="flex flex-col gap-1 rounded-md border px-3 py-2.5">
      <div className="flex items-baseline gap-2">
        {m.unread ? (
          <span
            className="size-1.5 shrink-0 translate-y-[-1px] self-center rounded-full bg-sky-500"
            title="Unread"
          >
            <span className="sr-only">Unread</span>
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate font-medium">
          {smsSenderLabel(m)}
        </span>
        <span
          className="shrink-0 text-muted-foreground"
          title={m.sentAt ? formatDateTime(m.sentAt) : undefined}
        >
          {smsAgo(m.sentAt, now) ?? "Unknown time"}
        </span>
      </div>
      <p
        className={cn(
          "text-xs/relaxed break-words whitespace-pre-wrap",
          m.binary && "font-mono text-[11px] break-all"
        )}
      >
        {m.text}
      </p>
      <div className="flex flex-wrap gap-1">
        {smsTags(m).map((t) => (
          <span
            key={t}
            className="rounded border border-border px-1 text-[10px] leading-4 text-muted-foreground"
          >
            {t}
          </span>
        ))}
      </div>
    </li>
  )
}

function SheetFooterInfo({
  read,
  now,
  clearAction,
}: {
  read: SmsRead
  now: number
  /** Offered beside the full-store warning, the case clearing exists for. */
  clearAction: React.ReactNode
}) {
  const result = read.result!
  const at = read.completedAt ?? read.createdAt
  const warnings = smsFullStoreWarnings(result.storage)
  const storage = smsStorageSummary(result.storage)
  const verb = isSmsClear(read) ? "Cleared" : "Read"
  return (
    <div
      className="flex flex-col gap-1.5 border-t border-border px-4 py-3 text-xs text-muted-foreground"
      data-testid="sms-footer"
    >
      <p>
        <span title={formatDateTime(at)}>
          {verb} {smsAgo(at, now) ?? "at an unknown time"}
        </span>
        {" · "}
        {smsShowingLabel(result)}
      </p>
      {storage ? (
        <p data-testid="sms-storage" title="Messages stored / capacity">
          Stored: {storage}
        </p>
      ) : null}
      {result.partial ? (
        <p>The device ran out of time, so some messages may be missing.</p>
      ) : null}
      {result.skipped > 0 ? (
        <p>
          {result.skipped} stored message{result.skipped === 1 ? "" : "s"}{" "}
          couldn't be decoded.
        </p>
      ) : null}
      {warnings.length > 0 ? (
        <div className="flex items-start gap-2" data-testid="sms-full-warning">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {warnings.map((w) => (
              <p
                key={w}
                className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400 [&>svg]:mt-px [&>svg]:size-3.5 [&>svg]:shrink-0"
              >
                <AlertTriangleIcon />
                {w}
              </p>
            ))}
          </div>
          {clearAction}
        </div>
      ) : null}
    </div>
  )
}
