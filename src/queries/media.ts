import { useCallback } from "react"
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { xg, type MediaSessionStatus } from "@/lib/xorgate"
import { RUNS_POLL_MS } from "@/lib/freshness"
import { runFromApi, type RecordingRun } from "@/lib/replay/runs"
import { qk } from "@/queries/keys"
import { useTenant } from "@/queries/tenant"

export interface SessionRunsParams {
  limit: number
  offset?: number
  order: "asc" | "desc"
  status?: MediaSessionStatus
  streamKey?: string
  from?: string
  to?: string
}

export interface SessionRunsPage {
  runs: RecordingRun[]
  total: number
  // Every stream key on this page, for the exact-match filter hint.
  streamKeys: string[]
}

/**
 * One page of a device's recording runs, server-clustered and paginated
 * (`?group=runs`; the endpoint forces sort=startedAt, so no `sort` param).
 *
 * `poll` (5s, Media tab) keeps open sessions' rollups growing while a backlog
 * drains. `keepPreviousData` holds the current rows through a filter change
 * so the table never blanks — and makes the old request-sequence guard
 * unnecessary: react-query only ever surfaces the newest key's answer.
 */
export function useSessionRuns(
  deviceId: string,
  params: SessionRunsParams,
  { poll = false }: { poll?: boolean } = {}
) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery({
    queryKey: qk.sessionRuns(orgId, wsId, deviceId, { ...params }),
    queryFn: async (): Promise<SessionRunsPage> => {
      const { items, page } = await xg().media.sessions.listRuns(
        deviceId,
        params
      )
      return {
        runs: items.map(runFromApi),
        total: page.total,
        streamKeys: [...new Set(items.flatMap((r) => r.streamKeys))],
      }
    },
    enabled: ready,
    refetchInterval: poll ? RUNS_POLL_MS : false,
    placeholderData: keepPreviousData,
  })
}

/**
 * The ordered segment index of one expanded session. Polled on the Media
 * tab's cadence while expanded (segments may still be arriving); previously
 * expanded sessions stay cached, so re-expanding one is instant.
 */
export function useSessionSegments(
  deviceId: string,
  sessionId: string | null,
  { poll = false }: { poll?: boolean } = {}
) {
  const { orgId, wsId, ready } = useTenant()
  return useQuery({
    queryKey: qk.segments(orgId, wsId, deviceId, sessionId ?? ""),
    queryFn: async () => {
      const { segments } = await xg().media.segments(deviceId, sessionId!)
      return segments
    },
    enabled: ready && sessionId !== null,
    refetchInterval: poll ? RUNS_POLL_MS : false,
  })
}

/** Refreshes every session/segment query for one device after a write. */
export function useInvalidateSessions(deviceId: string) {
  const { orgId, wsId } = useTenant()
  const queryClient = useQueryClient()
  return useCallback(() => {
    // Prefix matches: every filter's page of runs, and every session's
    // segment list, without touching the device's other queries.
    void queryClient.invalidateQueries({
      queryKey: [...qk.device(orgId, wsId, deviceId), "session-runs"],
    })
    void queryClient.invalidateQueries({
      queryKey: [...qk.device(orgId, wsId, deviceId), "segments"],
    })
  }, [queryClient, orgId, wsId, deviceId])
}
