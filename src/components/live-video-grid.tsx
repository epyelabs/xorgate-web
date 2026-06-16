import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { getKvsChannels, type KvsChannel } from "@/lib/api"
import { getKvsChannelsResponseSchema } from "@/lib/schemas"
import { useKvsViewer, type KvsStatus } from "@/hooks/use-kvs-viewer"

const STATUS_META: Record<
  KvsStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  connecting: { label: "Connecting", variant: "secondary" },
  waiting: { label: "Waiting for device", variant: "outline" },
  connected: { label: "Live", variant: "default" },
  closed: { label: "Reconnecting", variant: "outline" },
  error: { label: "Error", variant: "destructive" },
}

function LiveVideoTile({
  channel,
  label,
}: {
  channel: KvsChannel
  label: string
}) {
  const { videoRef, status, error } = useKvsViewer(channel)
  const meta = STATUS_META[status]

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="relative aspect-video max-h-[40vh] w-full bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-contain"
          />
          <div className="absolute left-2 top-2">
            <Badge variant={meta.variant}>{meta.label}</Badge>
          </div>
          <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
            {label}
          </div>
        </div>
        {status === "error" && error ? (
          <p className="text-destructive p-2 text-xs">{error}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/**
 * Live video grid: fetches the device's KVS channels and renders one VIEWER tile
 * per channel. The returned channels are the source of truth (a channel/ARN
 * exists); `videoCaps` only supplies friendly labels.
 */
export function LiveVideoGrid({
  deviceId,
  videoCaps,
}: {
  deviceId: string
  videoCaps: { key: string; label?: string }[]
}) {
  const [channels, setChannels] = useState<KvsChannel[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setChannels(null)
    setLoadError(null)
    ;(async () => {
      try {
        const raw = await getKvsChannels(deviceId)
        const parsed = getKvsChannelsResponseSchema.safeParse(raw)
        if (!parsed.success) throw new Error("Unexpected kvs-channels response")
        if (!cancelled) setChannels(parsed.data.channels)
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [deviceId])

  const labelFor = (streamKey: string) =>
    videoCaps.find((c) => c.key === streamKey)?.label ?? streamKey

  if (loadError) {
    return <p className="text-destructive text-sm">{loadError}</p>
  }

  if (channels === null) {
    return (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Skeleton className="aspect-video max-h-[40vh] w-full" />
        <Skeleton className="aspect-video max-h-[40vh] w-full" />
      </div>
    )
  }

  if (channels.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No live video channels. Provision the device to enable streaming.
      </p>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {channels.map((ch) => (
        <LiveVideoTile
          key={ch.channelArn}
          channel={ch}
          label={labelFor(ch.streamKey)}
        />
      ))}
    </div>
  )
}
