import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  clearSms,
  getLatestSmsRead,
  getSmsRead,
  smsErrorCode,
  startSmsRead,
  type SmsRead,
} from "@/lib/device-sms-api"
import { isSmsReadPending } from "@/lib/device-sms"
import { qk } from "@/queries/keys"
import { useTenant } from "@/queries/tenant"

// Device SMS inbox (plans/device-sms-inbox §4.3). ON DEMAND ONLY: nothing
// here runs unless the Messages sheet is open, nothing polls except an
// in-flight read, and the messages live in this cache alone (never in
// localStorage). The default gcTime (5 min) drops them after the sheet closes.

/** Poll cadence while a read is pending. The device answers in ~4 s. */
const SMS_READ_POLL_MS = 1500

/**
 * The stored copy: the newest `ok` read, null when the device has never been
 * read. Fetched only while the sheet is open and never polled; a fresh read
 * that lands `ok` is written in here by `useSmsRead`.
 */
export function useLatestSmsRead(deviceId: string, open: boolean) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery({
    queryKey: qk.deviceSmsLatest(orgId, wsId, deviceId),
    queryFn: () => getLatestSmsRead(deviceId),
    enabled: ready && open,
    // Each opening asks again (the stored copy may have been replaced by a
    // read from another viewer) but renders the cached list first.
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
}

/**
 * Start a read. The 202 row seeds the polled query, so the sheet shows
 * "pending" from the first render instead of waiting for the first poll.
 */
export function useStartSmsRead(deviceId: string) {
  const { orgId, wsId } = useTenant()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (limit: number) => startSmsRead(deviceId, limit),
    onSuccess: (read) => {
      queryClient.setQueryData(
        qk.deviceSmsRead(orgId, wsId, deviceId, read.id),
        read
      )
    },
  })
}

/**
 * Clear every message (plans/device-sms-clear). The 202 row (`action:
 * "clear"`) is an `SmsRead` like any other, so it seeds the same polled
 * query and the sheet tracks it through `useSmsRead`. On `ok` that row (with
 * its empty sweep) becomes the stored copy, and the cloud deletes the older
 * rows, so the old message text leaves the cache and the DB together.
 */
export function useClearSms(deviceId: string) {
  const { orgId, wsId } = useTenant()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (limit: number) => clearSms(deviceId, limit),
    onSuccess: (read) => {
      queryClient.setQueryData(
        qk.deviceSmsRead(orgId, wsId, deviceId, read.id),
        read
      )
    },
  })
}

/**
 * One read (or clear). Self-regulating poll (the `useDevicePurge` idiom): 1.5 s while
 * the row is pending, stopping by itself at a terminal status. `readId` null
 * disables it, which is how closing the sheet stops all traffic. On `ok` the
 * row becomes the stored copy, so the list swaps in place.
 */
export function useSmsRead(deviceId: string, readId: string | null) {
  const { orgId, wsId, ready } = useTenant()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: qk.deviceSmsRead(orgId, wsId, deviceId, readId ?? ""),
    queryFn: async (): Promise<SmsRead> => {
      let read: SmsRead
      try {
        read = await getSmsRead(deviceId, readId!)
      } catch (err) {
        // A newer `ok` read (another viewer's) deletes this device's older
        // rows, pending ones included (contract §5). That newer read is
        // exactly what this one was asking for, so show it instead of a 404.
        if (smsErrorCode(err) !== "NOT_FOUND") throw err
        const latest = await getLatestSmsRead(deviceId)
        if (!latest) throw err
        read = latest
      }
      if (read.status === "ok") {
        queryClient.setQueryData(qk.deviceSmsLatest(orgId, wsId, deviceId), read)
      }
      return read
    },
    enabled: ready && readId !== null,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: ({ state }) =>
      isSmsReadPending(state.data) ? SMS_READ_POLL_MS : false,
  })
}
