import { useCallback, useEffect, useState } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { getDeviceRecordings, type Recording } from "@/lib/api"
import { getDeviceRecordingsResponseSchema } from "@/lib/schemas"
import { useAuthStore } from "@/store/auth"
import { RecordingsTable } from "./-components/recordings-table"

export const Route = createFileRoute("/devices/$id/media")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DeviceMediaPage,
})

const POLL_MS = 5000

function DeviceMediaPage() {
  const { id } = Route.useParams()
  const [recordings, setRecordings] = useState<Recording[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const raw = await getDeviceRecordings(id)
      const parsed = getDeviceRecordingsResponseSchema.safeParse(raw)
      if (!parsed.success) throw new Error("Unexpected recordings response")
      setRecordings(parsed.data.recordings)
      setLoadError(null)
    } catch (err) {
      setLoadError((err as Error).message)
    }
  }, [id])

  // Poll while mounted so statuses/sizes stay current (e.g. recording -> completed).
  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Recordings</CardTitle>
          <CardDescription>
            Recorded video clips for this device. Start a recording from the
            Active Streams tab, or enable auto-record in Settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recordings === null ? (
            loadError ? (
              <p className="text-sm text-destructive">{loadError}</p>
            ) : (
              <Skeleton className="h-32 w-full" />
            )
          ) : recordings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recordings yet.</p>
          ) : (
            <RecordingsTable
              deviceId={id}
              recordings={recordings}
              onChanged={refresh}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
