// Pure decisions behind the SIM card's Messages sheet (plans/device-sms-inbox
// §4). The sheet is a thin renderer over these; the frontend vitest has no
// DOM, so this is where the tests live.
//
// PRIVACY (contract §6): nothing in here, or in the sheet, logs a message's
// text or sender. Counts and statuses only.

import type { Device, MembershipRole } from "@xorgate/sdk"
import { parseReportedConfig } from "./device-config-status"
import { formatMsisdn } from "./device-sim"
import { formatRelative } from "./relative-time"
import type {
  SmsClearedCounts,
  SmsMessage,
  SmsRead,
  SmsReadErrorCode,
  SmsReadResult,
  SmsStorage,
} from "./device-sms-api"

/** The count choices in the sheet's header. 50 is the API's cap. */
export const SMS_LIMITS = [10, 25, 50] as const
export type SmsLimit = (typeof SMS_LIMITS)[number]
export const DEFAULT_SMS_LIMIT: SmsLimit = 10

/** The capability strings the agent advertises (contract §3). */
export const SMS_READ_CAPABILITY = "sms.read"
/** plans/device-sms-clear contract §3. */
export const SMS_CLEAR_CAPABILITY = "sms.clear"

/**
 * Whether the device's agent advertises `capability` ("sms.read" unless
 * told otherwise).
 *
 *  - `yes`: `effective.agent.capabilities` includes it.
 *  - `no`: the agent reported a block but not the capability, so it is a
 *    build from before the feature. A request would 409 UNSUPPORTED_AGENT,
 *    and such an agent can never have produced a stored read either.
 *  - `unknown`: the device has not reported an agent block at all (never
 *    connected, or a report we could not parse). We let the sheet open: the
 *    stored read is the authority, and the API answers a request with a
 *    clean 409 when the agent turns out to be old.
 */
export function smsCapability(
  device: Device | null | undefined,
  capability: string = SMS_READ_CAPABILITY
): "yes" | "no" | "unknown" {
  const agent = parseReportedConfig(device?.reportedConfig)?.effective.agent
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
    return "unknown"
  }
  const caps = (agent as Record<string, unknown>).capabilities
  return Array.isArray(caps) && caps.includes(capability) ? "yes" : "no"
}

/** Parse a remembered count; anything off the menu falls back to 10. */
export function parseSmsLimit(raw: unknown): SmsLimit {
  const n = typeof raw === "string" ? Number(raw) : raw
  return SMS_LIMITS.includes(n as SmsLimit) ? (n as SmsLimit) : DEFAULT_SMS_LIMIT
}

/**
 * Newest first by `sentAt` (the device already sends them that way; this is
 * the belt to its braces). Undecodable timestamps go last, and ties keep the
 * device's order.
 */
export function sortSmsMessages(messages: readonly SmsMessage[]): SmsMessage[] {
  const at = (m: SmsMessage) => {
    const t = m.sentAt === null ? NaN : Date.parse(m.sentAt)
    return Number.isFinite(t) ? t : -Infinity
  }
  return messages
    .map((m, i) => ({ m, i, t: at(m) }))
    .sort((a, b) => (b.t === a.t ? a.i - b.i : b.t > a.t ? 1 : -1))
    .map((x) => x.m)
}

/**
 * The sender as a person reads it: numbers through `formatMsisdn` (NANP gets
 * its dashes, everything else untouched), alphanumeric senders ("BANK",
 * "Rogers") verbatim.
 */
export function smsSenderLabel(m: Pick<SmsMessage, "from" | "fromType">): string {
  const from = m.from.trim()
  if (from === "") return "Unknown sender"
  if (m.fromType === "alphanumeric") return from
  return formatMsisdn(from)
}

export const SMS_STORAGE_LABEL: Record<string, string> & Record<SmsStorage, string> = {
  SM: "SIM",
  ME: "Modem",
}

/** The small muted tags under a message, in display order. */
export function smsTags(m: SmsMessage): string[] {
  const tags = [SMS_STORAGE_LABEL[m.storage] ?? m.storage]
  if (m.incomplete) tags.push("Incomplete")
  if (m.truncated) tags.push("Truncated")
  if (m.binary) tags.push("Binary")
  return tags
}

/**
 * One sentence per full store. A full store is not cosmetic: the modem stops
 * accepting new messages into it, and nothing else in the product says so.
 */
export function smsFullStoreWarnings(
  storage: SmsReadResult["storage"] | null | undefined
): string[] {
  if (!storage) return []
  const out: string[] = []
  for (const key of ["ME", "SM"] as const) {
    const s = storage[key]
    if (!s || !(s.total > 0) || s.used < s.total) continue
    const where = key === "ME" ? "Modem storage" : "SIM storage"
    out.push(
      `${where} is full (${s.used}/${s.total}). New messages may not arrive.`
    )
  }
  return out
}

/** "showing 10 of 30", or "showing all 7" when nothing was cut. */
export function smsShowingLabel(result: SmsReadResult): string {
  const shown = result.messages.length
  if (shown >= result.total) return `showing all ${shown}`
  return `showing ${shown} of ${result.total}`
}

/** What a failed read (or clear) tells the operator. */
export function smsReadFailureMessage(
  read: Pick<SmsRead, "status" | "errorCode"> &
    Partial<Pick<SmsRead, "errorMessage" | "action">>
): string | null {
  if (read.status === "expired") return "The device didn't answer in time."
  if (read.status !== "error") return null
  const clearing = read.action === "clear"
  const code: SmsReadErrorCode | null = read.errorCode
  switch (code) {
    case "no_sim":
      return clearing
        ? "No SIM card was found, so there are no messages to clear."
        : "No SIM card was found, so there are no messages to read."
    case "no_modem":
      return "The device couldn't find its modem."
    case "modem_busy":
      return "The modem was busy. Try again in a moment."
    case "timeout":
      return "The device didn't answer in time."
    default: {
      if (!clearing) return "The device couldn't read its messages."
      // A failed delete can be partial (contract §2): say so, with the
      // device's own words ("delete ME failed"), which carry no message data.
      const detail = read.errorMessage?.trim()
      return detail
        ? `The device couldn't clear every message (${detail}). Some may already be deleted.`
        : "The device couldn't clear every message. Some may already be deleted."
    }
  }
}

/** The row asked the device to clear rather than read. */
export function isSmsClear(read: Pick<SmsRead, "action"> | null | undefined): boolean {
  return read?.action === "clear"
}

/**
 * How many messages a clear deleted, summed over the stores, or null when
 * the row carries no counts (a read, or a result without `cleared`).
 * Anything that is not a non-negative number counts as 0.
 */
export function smsClearedTotal(
  cleared: SmsClearedCounts | null | undefined
): number | null {
  if (!cleared || typeof cleared !== "object") return null
  let sum = 0
  for (const n of Object.values(cleared)) {
    if (typeof n === "number" && Number.isFinite(n) && n > 0) sum += Math.floor(n)
  }
  return sum
}

/** The toast after a clear lands: "Cleared 30 messages". */
export function smsClearedToast(cleared: SmsClearedCounts | null | undefined): string {
  const n = smsClearedTotal(cleared)
  if (n === null) return "Messages cleared"
  return `Cleared ${n.toLocaleString()} message${n === 1 ? "" : "s"}`
}

/** The confirm dialog's sentence. `total` null (unknown) or 0 drops the number. */
export function smsClearConfirmText(total: number | null | undefined): string {
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) {
    return "This deletes all messages from this device's SIM and modem."
  }
  if (total === 1) {
    return "This deletes the 1 message on this device's SIM and modem."
  }
  return `This deletes all ${total.toLocaleString()} messages from this device's SIM and modem.`
}

export const SMS_CLEAR_ROLE_REASON = "Only owners and admins can clear messages"
export const SMS_CLEAR_AGENT_REASON = "Update the device agent to clear messages"

/**
 * Whether "Clear all" is armed, and if not the tooltip that says why.
 * Checked in order: role (owner or admin, explicitly: a role still loading
 * counts as neither, unlike `useHasPermission`, which fails open), agent
 * capability, online, nothing already in flight. An agent that never
 * reported a block (`unknown`) is let through, as for reads: the API's 409
 * is the authority there.
 */
export function smsClearGate(input: {
  role: MembershipRole | null | undefined
  capability: "yes" | "no" | "unknown"
  online: boolean
  busy: boolean
}): { allowed: true; reason: null } | { allowed: false; reason: string } {
  if (input.role !== "owner" && input.role !== "admin") {
    return { allowed: false, reason: SMS_CLEAR_ROLE_REASON }
  }
  if (input.capability === "no") {
    return { allowed: false, reason: SMS_CLEAR_AGENT_REASON }
  }
  if (!input.online) {
    return { allowed: false, reason: "The device is offline" }
  }
  if (input.busy) {
    return { allowed: false, reason: "Waiting for the device to answer" }
  }
  return { allowed: true, reason: null }
}

/** "SIM 7/40 · Modem 23/23", or null when no store answered. */
export function smsStorageSummary(
  storage: SmsReadResult["storage"] | null | undefined
): string | null {
  if (!storage) return null
  const parts: string[] = []
  for (const key of ["SM", "ME"] as const) {
    const s = storage[key]
    if (!s) continue
    parts.push(`${SMS_STORAGE_LABEL[key]} ${s.used}/${s.total}`)
  }
  return parts.length > 0 ? parts.join(" · ") : null
}

/** The read the sheet is waiting on, if any, is still in flight. */
export function isSmsReadPending(read: SmsRead | null | undefined): boolean {
  return read?.status === "pending"
}

/**
 * Which list the sheet renders. The stored read (`latest`) is the list; a
 * fresh read only replaces it once it lands `ok` (the query layer writes it
 * into the latest cache then). Reading the fresh row first as well makes the
 * swap immediate even before the cache write re-renders.
 */
export function smsDisplayedRead(
  latest: SmsRead | null | undefined,
  current: SmsRead | null | undefined
): SmsRead | null {
  if (current?.status === "ok" && current.result) return current
  if (latest?.status === "ok" && latest.result) return latest
  return null
}

/**
 * "12s ago", "3d ago" (the `formatRelative` scale), or null for a stamp that
 * does not parse. A device clock a little ahead reads as "0s ago", not as a
 * negative age.
 */
export function smsAgo(iso: string | null, now: number = Date.now()): string | null {
  if (iso === null || !Number.isFinite(Date.parse(iso))) return null
  return `${formatRelative(iso, now)} ago`
}
