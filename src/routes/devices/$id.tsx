import { useEffect, useState } from "react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, getDevice, type Device, type DeviceStatus } from "@/lib/api"
import { getDeviceResponseSchema } from "@/lib/schemas"
import { useAuthStore } from "@/store/auth"

export const Route = createFileRoute("/devices/$id")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DeviceDetailPage,
})

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

function formatTimestamp(iso: string | null): string {
  if (!iso) return "Never"
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return dateTimeFormat.format(parsed)
}

function statusVariant(
  status: DeviceStatus
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "online":
      return "default"
    case "offline":
      return "destructive"
    case "provisioned":
      return "secondary"
    case "decommissioned":
      return "outline"
  }
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}

function DeviceDetailPage() {
  const { id } = Route.useParams()
  const [device, setDevice] = useState<Device | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const raw = await getDevice(id)
        const parsed = getDeviceResponseSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error("Unexpected /devices/:id response shape")
        }
        if (!cancelled) setDevice(parsed.data.device)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          if (!cancelled) setNotFound(true)
          return
        }
        const message = (err as Error).message
        if (!cancelled) setError(message)
        toast.error(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div>
        <Link
          to="/devices"
          className="text-muted-foreground hover:text-foreground text-xs"
        >
          ← Back to devices
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            {device?.name ?? device?.serial ?? "Device"}
          </CardTitle>
          <CardDescription>
            {device ? device.id : "Loading device details."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {notFound ? (
            <p className="text-muted-foreground text-sm">Device not found.</p>
          ) : error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : device === null ? (
            <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ))}
            </dl>
          ) : (
            <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Serial" value={device.serial} />
              <Field label="Name" value={device.name ?? "-"} />
              <Field
                label="Status"
                value={
                  <Badge variant={statusVariant(device.status)}>
                    {device.status}
                  </Badge>
                }
              />
              <Field
                label="Firmware version"
                value={device.firmwareVersion ?? "-"}
              />
              <Field label="Project ID" value={device.projectId} />
              <Field label="Device model ID" value={device.deviceModelId} />
              <Field
                label="Last seen"
                value={formatTimestamp(device.lastSeenAt)}
              />
              <Field
                label="Created"
                value={formatTimestamp(device.createdAt)}
              />
              <Field
                label="Updated"
                value={formatTimestamp(device.updatedAt)}
              />
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
