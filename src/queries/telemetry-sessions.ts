import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { TelemetrySession } from "@xorgate/sdk"
import { xg } from "@/lib/xorgate"
import { qk } from "@/queries/keys"
import { useTenant } from "@/queries/tenant"

export interface TelemetrySessionsParams {
  /** OVERLAP semantics, like the media sessions list. Omit both for "any". */
  from?: string
  to?: string
  limit?: number
}

export interface TelemetrySessionsPage {
  sessions: TelemetrySession[]
  total: number
}

/**
 * The recorded-telemetry session index for one device (telemetry-session-
 * artifacts plan, README §4.2): one row per session the device recorded,
 * with counters and insights, newest first. No URLs: the replay manifest
 * presigns a session's artifacts when they are needed.
 */
export function useTelemetrySessions(
  deviceId: string,
  params: TelemetrySessionsParams,
  { enabled = true }: { enabled?: boolean } = {}
) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery({
    queryKey: qk.telemetrySessions(orgId, wsId, deviceId, { ...params }),
    queryFn: async (): Promise<TelemetrySessionsPage> => {
      const { items, page } = await xg().telemetry.sessions.list(deviceId, {
        from: params.from,
        to: params.to,
        limit: params.limit ?? 50,
        order: "desc",
        status: "any",
      })
      return { sessions: items, total: page.total }
    },
    enabled: ready && enabled,
    placeholderData: keepPreviousData,
  })
}
