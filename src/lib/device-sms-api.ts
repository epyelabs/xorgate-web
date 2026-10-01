import { isXorgateError } from "@xorgate/sdk"
import { xg } from "./xorgate"

// Device SMS inbox (plans/device-sms-inbox, contract §4). Raw `xg().request`
// calls against the core routes, the device-purge-api.ts precedent, so the
// sheet is not blocked on the SDK release.
// TODO: switch to `xg().devices.sms.read(id, { limit })`, `.get(id, readId)`
// and `.latest(id)` plus the SDK's SmsRead types once @xorgate/sdk 0.12.0 is
// published.

/** Where the modem keeps a message: the SIM card or the modem's own memory. */
export type SmsStorage = "SM" | "ME"

export type SmsFromType = "international" | "national" | "alphanumeric" | "other"

/** One message as the device decoded it (contract §2). */
export type SmsMessage = {
  /** storage:index joined by "+"; stable within one sweep only. */
  id: string
  storage: SmsStorage
  indexes: number[]
  /** As decoded; alphanumeric senders verbatim. */
  from: string
  fromType: SmsFromType
  /** SCTS with its own offset; null when undecodable. */
  sentAt: string | null
  unread: boolean
  /** Decoded text; a hex string when `binary`. */
  text: string
  binary: boolean
  /** A concatenated message with missing parts. */
  incomplete: boolean
  /** Text cut at 4000 characters by the device. */
  truncated: boolean
}

export type SmsStoreUsage = { used: number; total: number }

/** The payload of an `ok` read. */
export type SmsReadResult = {
  /** Only the stores that answered. */
  storage: Partial<Record<SmsStorage, SmsStoreUsage>>
  /** Messages after concatenation, before the limit cut. */
  total: number
  /** PDUs that were not SMS-DELIVER or failed to decode. */
  skipped: number
  /** The device's sweep budget ran out. */
  partial: boolean
  durationMs: number
  /** Newest first, at most `limit`. */
  messages: SmsMessage[]
}

export type SmsReadStatus = "pending" | "ok" | "error" | "expired"

/** The device's status when not ok, or "timeout" on expiry. */
export type SmsReadErrorCode =
  | "no_modem"
  | "no_sim"
  | "modem_busy"
  | "error"
  | "timeout"

export type SmsRead = {
  id: string
  deviceId: string
  status: SmsReadStatus
  errorCode: SmsReadErrorCode | null
  errorMessage: string | null
  limit: number
  requestedBy: string
  createdAt: string
  completedAt: string | null
  /** Present only when `status` is `ok`. */
  result: SmsReadResult | null
}

/** 409 codes from POST /sms-reads. */
export const SMS_DEVICE_OFFLINE = "DEVICE_OFFLINE"
export const SMS_UNSUPPORTED_AGENT = "UNSUPPORTED_AGENT"
/** 404 code from GET /sms-reads/latest when the device has never been read. */
export const NO_SMS_READ = "NO_SMS_READ"

/** The API code of an error, widened: the SDK's union predates these codes. */
export function smsErrorCode(err: unknown): string | null {
  return isXorgateError(err) ? (err.code as string) : null
}

/** Ask the device for its newest `limit` messages. 202 with a pending row. */
export async function startSmsRead(
  deviceId: string,
  limit: number
): Promise<SmsRead> {
  return xg().request("POST", `/devices/${deviceId}/sms-reads`, {
    body: { limit },
  })
}

/** One read; a pending row older than 45 s comes back `expired`. */
export async function getSmsRead(
  deviceId: string,
  readId: string
): Promise<SmsRead> {
  return xg().request("GET", `/devices/${deviceId}/sms-reads/${readId}`)
}

/**
 * The stored copy: the newest `ok` read, or null when the device has never
 * been read (404 NO_SMS_READ). Works whether or not the device is online.
 */
export async function getLatestSmsRead(
  deviceId: string
): Promise<SmsRead | null> {
  try {
    return await xg().request<SmsRead>(
      "GET",
      `/devices/${deviceId}/sms-reads/latest`
    )
  } catch (err) {
    if (smsErrorCode(err) === NO_SMS_READ) return null
    throw err
  }
}
