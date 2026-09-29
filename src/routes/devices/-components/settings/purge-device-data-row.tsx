import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { Device } from "@xorgate/sdk"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useCurrentRole } from "@/lib/permissions"
import { formatRelative } from "@/lib/relative-time"
import type {
  DevicePurge,
  DevicePurgeCounts,
  DevicePurgeStatus,
} from "@/lib/device-purge-api"
import {
  isPurgeActive,
  useDevicePurge,
  useInvalidateAfterPurge,
  useLatestDevicePurge,
  useSeedDevicePurge,
} from "@/queries/device-purges"
import { useMembers } from "@/queries/org"
import { useAuthStore } from "@/store/auth"
import { DangerRow } from "./danger-row"
import { PurgeDeviceDataDialog, plural } from "./purge-device-data-dialog"
import { formatTimestamp } from "./shared"

/** What the worker is doing, in the operator's words. */
const STEP_LABEL: Record<string, string> = {
  "workflows.attachments": "detaching workflows",
  "workflows.stop": "stopping runs",
  "workflows.runs": "deleting runs",
  "telemetry.s3": "deleting telemetry files",
  "telemetry.sessions": "deleting telemetry sessions",
  "telemetry.ingestLog": "clearing the ingest log",
  "telemetry.readings": "deleting readings",
  "media.s3": "deleting recordings",
  "media.sessions": "deleting media sessions",
  done: "finishing",
}

/** "3 workflows, 128 runs, 4,985 readings": zeros and untouched scopes drop out. */
export function countsSummary(counts: DevicePurgeCounts): string {
  const parts: string[] = []
  if (counts.attachments) parts.push(plural(counts.attachments, "workflow"))
  if (counts.runs) parts.push(plural(counts.runs, "run"))
  if (counts.telemetrySessions)
    parts.push(plural(counts.telemetrySessions, "telemetry session"))
  if (counts.readings) parts.push(plural(counts.readings, "reading"))
  if (counts.mediaSessions) parts.push(plural(counts.mediaSessions, "recording"))
  return parts.join(", ")
}

/**
 * Purging a device's history. Owner or admin only, and rendered for nobody
 * else: a member who cannot do it has nothing to read here. The role check
 * is explicit rather than `useHasPermission`, which fails open while
 * memberships load — fine for a page, wrong for a button that destroys
 * everything a device has recorded.
 */
export function PurgeDeviceDataRow({ device }: { device: Device }) {
  const role = useCurrentRole()
  if (role !== "owner" && role !== "admin") return null
  return <PurgeDeviceDataRowInner device={device} />
}

function PurgeDeviceDataRowInner({ device }: { device: Device }) {
  const [open, setOpen] = useState(false)
  // The purge this page started (or picked up on mount); null until then.
  const [trackedId, setTrackedId] = useState<string | null>(null)
  const latestQuery = useLatestDevicePurge(device.id)
  const latest = latestQuery.data ?? null
  // A page opened while a purge is already running polls that one.
  const activeId =
    trackedId ?? (latest && isPurgeActive(latest.status) ? latest.id : null)
  const polled = useDevicePurge(device.id, activeId)
  const seedPurge = useSeedDevicePurge()
  const invalidateAfterPurge = useInvalidateAfterPurge()

  // What the line under the description describes: the polled row while one
  // is tracked, otherwise the latest from the list.
  const current: DevicePurge | null = activeId
    ? (polled.data ?? (latest?.id === activeId ? latest : null))
    : latest
  const inProgress = activeId !== null && (current === null || isPurgeActive(current.status))
  // A stalled worker is not "busy": the next POST closes it as abandoned.
  const busy = inProgress && !current?.stalled

  // Completion is a transition, not a state: toast only when this page saw
  // the purge queued or running first, so a page opened onto an old
  // succeeded row stays quiet.
  const prevStatus = useRef<DevicePurgeStatus | null>(null)
  useEffect(() => {
    const row = polled.data
    const status = row?.status ?? null
    const prev = prevStatus.current
    prevStatus.current = status
    if (!row || status === prev || !isPurgeActive(prev ?? undefined)) return
    if (status === "succeeded") {
      invalidateAfterPurge(device.id)
      const summary = countsSummary(row.counts)
      toast.success(summary ? `Purge finished: ${summary}` : "Purge finished")
    } else if (status === "failed") {
      toast.error(`Purge failed: ${row.error ?? "unknown error"}`)
    }
  }, [polled.data, device.id, invalidateAfterPurge])

  const requestedByLabel = useRequestedByLabel(current?.requestedBy ?? null)

  let detail: React.ReactNode = null
  if (inProgress) {
    if (current?.stalled) {
      detail = (
        <span data-testid="purge-status-stalled">
          Purge stalled: the worker stopped mid-way. Start another to resume.
        </span>
      )
    } else {
      const step = current?.cursor?.step
      const progress = current ? countsSummary(current.counts) : ""
      detail = (
        <span data-testid="purge-status-in-progress">
          Purge in progress
          {step ? `: ${STEP_LABEL[step] ?? step}` : ""}
          {progress ? ` · ${progress}` : ""}
          …
        </span>
      )
    }
  } else if (current?.status === "succeeded") {
    detail = (
      <span
        data-testid="purge-status-last"
        title={formatTimestamp(current.finishedAt ?? current.requestedAt)}
      >
        Last purged {formatRelative(current.finishedAt ?? current.requestedAt)}{" "}
        ago{requestedByLabel ? ` by ${requestedByLabel}` : ""}
      </span>
    )
  } else if (current?.status === "failed") {
    detail = (
      <span data-testid="purge-status-failed">
        Last purge failed: {current.error ?? "unknown error"}
      </span>
    )
  }

  return (
    <>
      <DangerRow
        testId="purge-device-data-row"
        title="Purge data"
        description="Delete this device's attached workflows and their runs, recorded telemetry and recorded media, up to now. The device, its identity, live streams and settings stay."
        detail={detail}
        action={
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => setOpen(true)}
            data-testid="purge-device-data"
          >
            Purge data…
          </Button>
        }
      />
      <Separator />
      <PurgeDeviceDataDialog
        open={open}
        onOpenChange={setOpen}
        device={device}
        onStarted={(purge) => {
          seedPurge(purge)
          setTrackedId(purge.id)
        }}
        onAlreadyRunning={() => {
          void latestQuery.refetch()
        }}
      />
    </>
  )
}

/**
 * "you", a member's name or email, or null. `requestedBy` is a user id or an
 * API key id; an id nobody on the roster owns (an API key, a departed
 * member) simply gets no attribution rather than a raw uuid.
 */
function useRequestedByLabel(requestedBy: string | null): string | null {
  const me = useAuthStore((s) => s.user)
  const members = useMembers()
  if (!requestedBy) return null
  if (me && me.id === requestedBy) return "you"
  const member = members.data?.find((m) => m.userId === requestedBy)
  return member?.user?.name ?? member?.user?.email ?? null
}
