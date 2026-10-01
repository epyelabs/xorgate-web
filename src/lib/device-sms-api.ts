import { isXorgateError } from "@xorgate/sdk"
import type { SmsRead } from "@xorgate/sdk"
import { xg } from "./xorgate"

// Device SMS inbox (plans/device-sms-inbox, contract §4), on
// `xg().devices.sms` (@xorgate/sdk 0.12.0).

export type {
  SmsMessage,
  SmsRead,
  SmsReadErrorCode,
  SmsReadResult,
  SmsReadStatus,
  SmsStorage,
} from "@xorgate/sdk"

/** Used/total of one store, as `SmsReadResult.storage` carries it. */
export type SmsStoreUsage = { used: number; total: number }

/** 409 codes from `sms.read()`. */
export const SMS_DEVICE_OFFLINE = "DEVICE_OFFLINE"
export const SMS_UNSUPPORTED_AGENT = "UNSUPPORTED_AGENT"

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
