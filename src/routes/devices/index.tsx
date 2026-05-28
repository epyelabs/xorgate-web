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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { listDevices, type Device, type DeviceStatus } from "@/lib/api"
import { listDevicesResponseSchema } from "@/lib/schemas"
import { useAuthStore } from "@/store/auth"
import { useWorkspaceStore } from "@/store/workspace"

export const Route = createFileRoute("/devices/")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DevicesListPage,
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

function DevicesListPage() {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const currentProjectId = useWorkspaceStore((s) => s.currentProjectId)

  useEffect(() => {
    let cancelled = false
    setDevices(null)
    setError(null)
    ;(async () => {
      try {
        const raw = await listDevices()
        const parsed = listDevicesResponseSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error("Unexpected /devices response shape")
        }
        if (!cancelled) setDevices(parsed.data.devices)
      } catch (err) {
        const message = (err as Error).message
        if (!cancelled) setError(message)
        toast.error(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [currentProjectId])

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <Card>
        <CardHeader>
          <CardTitle>Devices</CardTitle>
          <CardDescription>
            All devices in the active organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : devices === null ? (
            <p className="text-muted-foreground animate-pulse text-sm">
              Loading...
            </p>
          ) : devices.length === 0 ? (
            <p className="text-muted-foreground text-sm">No devices yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Serial</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((device) => (
                  <TableRow key={device.id}>
                    <TableCell>
                      <Link
                        to="/devices/$id"
                        params={{ id: device.id }}
                        className="text-primary font-medium hover:underline"
                      >
                        {device.serial}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {device.name ?? "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(device.status)}>
                        {device.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatTimestamp(device.lastSeenAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatTimestamp(device.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
