import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { type DateRangeMode } from "@/components/data-table"
import { type MediaSessionStatus } from "@/lib/xorgate"
import {
  DeviceSessionsCard,
  SESSION_PAGE_SIZES,
  SESSION_SORT_KEYS,
  SESSION_STATUSES,
  type SessionsSearch,
  type SessionSortKey,
} from "./-components/device-sessions-card"

const RANGE_MODES: DateRangeMode[] = ["all", "1h", "6h", "24h", "7d", "custom"]

// Filter state lives in the URL (same dialect the deleted cloud table used) so
// a filtered view is shareable/bookmarkable and Back restores it. Defaults are
// encoded as *absent* params, keeping the common case a clean URL.
export const Route = createFileRoute("/devices/$id/media")({
  beforeLoad: requireAuth,
  validateSearch: (search: Record<string, unknown>): SessionsSearch => {
    const sizeNum = Number(search.size)
    const size = SESSION_PAGE_SIZES.includes(sizeNum) ? sizeNum : undefined
    const pageNum = Number(search.page)
    const page = Number.isInteger(pageNum) && pageNum > 1 ? pageNum : undefined
    const order =
      search.order === "asc" ? "asc" : search.order === "desc" ? "desc" : undefined
    const sort = SESSION_SORT_KEYS.includes(search.sort as SessionSortKey)
      ? (search.sort as SessionSortKey)
      : undefined
    const status = SESSION_STATUSES.includes(search.status as MediaSessionStatus)
      ? (search.status as MediaSessionStatus)
      : undefined
    const range = RANGE_MODES.includes(search.range as DateRangeMode)
      ? (search.range as DateRangeMode)
      : undefined
    const streamKey =
      typeof search.streamKey === "string" && search.streamKey !== ""
        ? search.streamKey
        : undefined
    return {
      page,
      size,
      order,
      sort,
      status,
      streamKey,
      range,
      from: typeof search.from === "string" ? search.from : undefined,
      to: typeof search.to === "string" ? search.to : undefined,
    }
  },
  component: DeviceMediaPage,
})

function DeviceMediaPage() {
  const { id } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const update = (patch: Partial<SessionsSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }) })

  // Device-recorded sessions (offline recording plan). The cloud
  // viewer-recorder's table that used to sit above this is gone; its filters,
  // search, pagination and CSV export now drive this card instead — server-side
  // (decision H), with run clustering applied to whatever the page returns.
  return (
    // Same height contract as Telemetry History: claim the tab's height so the
    // card can bound its own scroll area rather than growing the page.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <DeviceSessionsCard deviceId={id} search={search} onSearchChange={update} />
    </div>
  )
}
