// Pure decisions behind the SIM card's Messages sheet (plans/device-sms-inbox
// §4). The sheet is a thin renderer over these; the frontend vitest has no
// DOM, so this is where the tests live.
//
// PRIVACY (contract §6): nothing in here, or in the sheet, logs a message's
// text or sender. Counts and statuses only.

import type { Device } from "@xorgate/sdk"
import { parseReportedConfig } from "./device-config-status"
import { formatMsisdn } from "./device-sim"
import { formatRelative } from "./relative-time"
import type {
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

/** The capability string the agent advertises (contract §3). */
export const SMS_READ_CAPABILITY = "sms.read"

/**
 * Whether the device's agent can read SMS.
 *
 *  - `yes`: `effective.agent.capabilities` includes "sms.read".
 *  - `no`: the agent reported a block but not the capability, so it is a
 *    build from before this feature. A read would 409 UNSUPPORTED_AGENT, and
 *    such an agent can never have produced a stored read either.
 *  - `unknown`: the device has not reported an agent block at all (never
 *    connected, or a report we could not parse). We let the sheet open: the
 *    stored read is the authority, and the API answers a read request with a
 *    clean 409 when the agent turns out to be old.
 */
export function smsCapability(
  device: Device | null | undefined
): "yes" | "no" | "unknown" {
  const agent = parseReportedConfig(device?.reportedConfig)?.effective.agent
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
    return "unknown"
  }
  const caps = (agent as Record<string, unknown>).capabilities
  return Array.isArray(caps) && caps.includes(SMS_READ_CAPABILITY) ? "yes" : "no"
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

export const SMS_STORAGE_LABEL: Record<SmsStorage, string> = {
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

/** What a failed read tells the operator. */
export function smsReadFailureMessage(
  read: Pick<SmsRead, "status" | "errorCode">
): string | null {
  if (read.status === "expired") return "The device didn't answer in time."
  if (read.status !== "error") return null
  const code: SmsReadErrorCode | null = read.errorCode
  switch (code) {
    case "no_sim":
      return "No SIM card was found, so there are no messages to read."
    case "no_modem":
      return "The device couldn't find its modem."
    case "modem_busy":
      return "The modem was busy. Try again in a moment."
    case "timeout":
      return "The device didn't answer in time."
    default:
      return "The device couldn't read its messages."
  }
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
