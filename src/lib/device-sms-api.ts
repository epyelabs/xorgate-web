import { isXorgateError } from "@xorgate/sdk"
import type { SmsRead, SmsStorage } from "@xorgate/sdk"
import { xg } from "./xorgate"

// Device SMS inbox (plans/device-sms-inbox) and "Clear all"
// (plans/device-sms-clear), on `xg().devices.sms` (@xorgate/sdk 0.13.0).

export type {
  SmsMessage,
  SmsRead,
  SmsReadAction,
  SmsReadErrorCode,
  SmsReadResult,
  SmsReadStatus,
  SmsStorage,
} from "@xorgate/sdk"

/** Messages present in each store before a clear deleted them. */
export type SmsClearedCounts = Partial<Record<SmsStorage, number>>

/** Used/total of one store, as `SmsReadResult.storage` carries it. */
export type SmsStoreUsage = { used: number; total: number }

/** 409 codes from `sms.read()` and the clear route. */
export const SMS_DEVICE_OFFLINE = "DEVICE_OFFLINE"
export const SMS_UNSUPPORTED_AGENT = "UNSUPPORTED_AGENT"
/** 403 from the clear route: owners and admins only. */
export const SMS_INSUFFICIENT_ROLE = "INSUFFICIENT_ROLE"

/** The API code of an error, or null for anything that is not an API error. */
export function smsErrorCode(err: unknown): string | null {
  return isXorgateError(err) ? (err.code as string) : null
}

/** Ask the device for its newest `limit` messages. 202 with a pending row. */
export function startSmsRead(deviceId: string, limit: number): Promise<SmsRead> {
  return xg().devices.sms.read(deviceId, { limit })
}

/** One read; a pending row older than 45 s comes back `expired`. */
export function getSmsRead(deviceId: string, readId: string): Promise<SmsRead> {
  return xg().devices.sms.get(deviceId, readId)
}

/**
 * The stored copy: the newest `ok` read, or null when the device has never
 * been read. Works whether or not the device is online.
 */
export function getLatestSmsRead(deviceId: string): Promise<SmsRead | null> {
  return xg().devices.sms.latest(deviceId)
}

/**
 * Delete every message from the SIM and modem stores (owner/admin). 202 with
 * a pending row (`action: "clear"`) that is polled exactly like a read; on
 * `ok` its result is the follow-up sweep of `limit` messages (normally none).
 */
export function clearSms(deviceId: string, limit: number): Promise<SmsRead> {
  return xg().devices.sms.clear(deviceId, { limit })
}
