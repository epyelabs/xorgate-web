import { useEffect, useState } from "react"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ApiError,
  deleteDevice,
  getDevice,
  getDeviceIdentity,
  getKvsChannels,
  updateDevice,
  type Device,
  type DeviceIdentity,
  type DeviceStatus,
  type KvsChannel,
} from "@/lib/api"
import {
  getDeviceIdentityResponseSchema,
  getDeviceResponseSchema,
  getKvsChannelsResponseSchema,
  updateDeviceSchema,
} from "@/lib/schemas"
import { useAuthStore } from "@/store/auth"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import { DeleteDeviceDialog } from "./-components/delete-device-dialog"
import { InfoRow } from "./-components/info-row"

export const Route = createFileRoute("/devices/$id/settings")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DeviceSettingsPage,
})

const STATUS_OPTIONS: DeviceStatus[] = [
  "provisioned",
  "online",
  "offline",
  "decommissioned",
]

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

function DeviceSettingsPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()

  const [device, setDevice] = useState<Device | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  // Editable form state + the last-saved baseline used to detect real changes.
  const [name, setName] = useState("")
  const [status, setStatus] = useState<DeviceStatus>("provisioned")
  const [baseline, setBaseline] = useState<{
    name: string
    status: DeviceStatus
  } | null>(null)
  const [saving, setSaving] = useState(false)

  // Read-only sections, fetched independently so a failure here never blocks the form.
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null)
  const [identityLoaded, setIdentityLoaded] = useState(false)
  const [channels, setChannels] = useState<KvsChannel[] | null>(null)

  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const raw = await getDevice(id)
        const parsed = getDeviceResponseSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error("Unexpected /devices/:id response shape")
        }
        if (cancelled) return
        const fetched = parsed.data.device
        setDevice(fetched)
        const initialName = fetched.name ?? ""
        setName(initialName)
        setStatus(fetched.status)
        setBaseline({ name: initialName, status: fetched.status })
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

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const raw = await getDeviceIdentity(id)
        const parsed = getDeviceIdentityResponseSchema.safeParse(raw)
        if (!cancelled && parsed.success) setIdentity(parsed.data.identity)
      } catch {
        // Identity is best-effort metadata; leave it null on failure.
      } finally {
        if (!cancelled) setIdentityLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const raw = await getKvsChannels(id)
        const parsed = getKvsChannelsResponseSchema.safeParse(raw)
        if (!cancelled) setChannels(parsed.success ? parsed.data.channels : [])
      } catch {
        if (!cancelled) setChannels([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  // Auto-save the editable fields. Fires on name blur-out and status change;
  // no-ops when nothing actually changed so incidental blurs don't hit the API.
  async function commit(next: { name: string; status: DeviceStatus }) {
    if (saving || baseline === null) return
    const trimmed = next.name.trim()
    if (trimmed === baseline.name.trim() && next.status === baseline.status) {
      // Snap the input back to the stored value (e.g. trimmed whitespace).
      if (next.name !== baseline.name) setName(baseline.name)
      return
    }
    const parsed = updateDeviceSchema.safeParse(next)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input")
      return
    }
    setSaving(true)
    try {
      const res = await updateDevice(id, {
        name: trimmed === "" ? null : trimmed,
        status: parsed.data.status,
      })
      const updated = res.device
      setDevice(updated)
      const nextName = updated.name ?? ""
      setName(nextName)
      setStatus(updated.status)
      setBaseline({ name: nextName, status: updated.status })
      // Keep the breadcrumb in sync after a rename (the layout header refreshes
      // on next navigation; the breadcrumb store updates live).
      useBreadcrumbStore
        .getState()
        .setDeviceName(updated.name ?? updated.serial)
      toast.success("Settings saved")
    } catch (err) {
      // Roll the form back to the last saved values so the UI matches the server.
      toast.error((err as Error).message)
      setName(baseline.name)
      setStatus(baseline.status)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    try {
      await deleteDevice(id)
    } catch (err) {
      toast.error((err as Error).message)
      return
    }
    toast.success("Device deleted")
    setDeleteOpen(false)
    navigate({ to: "/devices" })
  }

  if (notFound) {
    return <p className="text-sm text-muted-foreground">Device not found.</p>
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {/* Row 1: editable form (left half) + read-only details (right half) */}
      <Card>
        <CardHeader>
          <CardTitle>Device settings</CardTitle>
          <CardDescription>
            Update how this device is identified and its lifecycle status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {device === null ? (
            error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : (
              <Skeleton className="h-48 w-full" />
            )
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                commit({ name, status })
              }}
            >
              <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="device-name">Name</FieldLabel>
                    <Input
                      id="device-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={() => commit({ name, status })}
                      placeholder={device.serial}
                      maxLength={80}
                      disabled={saving}
                    />
                    <FieldDescription>
                      Falls back to the serial number when left blank. Saved
                      automatically.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="device-status">Status</FieldLabel>
                    <Select
                      value={status}
                      disabled={saving}
                      onValueChange={(v) => {
                        const next = v as DeviceStatus
                        setStatus(next)
                        commit({ name, status: next })
                      }}
                    >
                      <SelectTrigger id="device-status" className="capitalize">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s} value={s} className="capitalize">
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 self-start border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10">
                  <InfoRow label="Serial" value={device.serial} mono />
                  <InfoRow label="Model" value={device.deviceModelId} mono />
                  <InfoRow label="Device ID" value={device.id} mono />
                  <InfoRow
                    label="Firmware Ver"
                    value={device.firmwareVersion ?? "—"}
                    mono
                  />
                  <InfoRow
                    label="Created"
                    value={formatTimestamp(device.createdAt)}
                  />
                  <InfoRow
                    label="Updated"
                    value={formatTimestamp(device.updatedAt)}
                  />
                </dl>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Row 2: IoT identity (left) + Media channels (right), equal height */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>IoT identity</CardTitle>
            <CardDescription>
              X.509 certificate binding created during provisioning. Read-only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!identityLoaded ? (
              <Skeleton className="h-24 w-full" />
            ) : identity === null ? (
              <p className="text-xs text-muted-foreground">
                Device not provisioned yet.
              </p>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <InfoRow
                  label="Thing name"
                  value={identity.iotThingName}
                  mono
                />
                <InfoRow
                  label="Certificate ID"
                  value={identity.certificateId}
                  mono
                />
                <InfoRow
                  label="Status"
                  value={
                    <Badge
                      variant={
                        identity.status === "active" ? "default" : "outline"
                      }
                      className="capitalize"
                    >
                      {identity.status}
                    </Badge>
                  }
                />
                <InfoRow label="Policy" value={identity.policyName} mono />
                <InfoRow label="Role alias" value={identity.roleAlias} mono />
                <InfoRow
                  label="Created"
                  value={formatTimestamp(identity.createdAt)}
                />
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Media channels</CardTitle>
            <CardDescription>
              KVS signaling channels provisioned for live video. Read-only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {channels === null ? (
              <Skeleton className="h-16 w-full" />
            ) : channels.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No media channels — device not provisioned.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stream</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Region</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {channels.map((channel) => (
                    <TableRow key={channel.streamKey}>
                      <TableCell className="font-mono">
                        {channel.streamKey}
                      </TableCell>
                      <TableCell className="font-mono">
                        {channel.channelName}
                      </TableCell>
                      <TableCell>{channel.region}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Danger zone */}
      <Card className="ring-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Permanently delete this device and all of its data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
            disabled={device === null}
          >
            Delete device
          </Button>
        </CardContent>
      </Card>

      {device ? (
        <DeleteDeviceDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          deviceName={device.name ?? device.serial}
          onConfirm={handleDelete}
        />
      ) : null}
    </div>
  )
}
