import { useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
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
import { Skeleton } from "@/components/ui/skeleton"
import {
  deleteDevice,
  getDeviceModel,
  type Device,
  type DeviceIdentity,
} from "@/lib/api"
import { reportedAgentMode } from "@/lib/device-config-status"
import { getDeviceModelResponseSchema, updateDeviceSchema } from "@/lib/schemas"
import { DeleteDeviceDialog } from "../delete-device-dialog"
import { InfoRow } from "../info-row"
import { formatTimestamp } from "./shared"

const NAME_KEY = "device-name"
const MAX_NAME_LENGTH = 80

export function GeneralTab({
  device,
  identity,
  identityLoaded,
  isPending,
  commit,
}: {
  device: Device
  identity: DeviceIdentity | null
  identityLoaded: boolean
  isPending: (key: string) => boolean
  commit: (key: string, patch: { name?: string | null }) => void
}) {
  const navigate = useNavigate()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const agentMode = reportedAgentMode(device)

  // Kept as a string so partial input never fights the user; re-seeded whenever
  // the device object changes, which is also how a failed save snaps back.
  const [name, setName] = useState(device.name ?? "")
  useEffect(() => {
    setName(device.name ?? "")
  }, [device.name])

  // Model name, not the raw id. Best-effort, and deliberately NOT falling back
  // to the id while the request is still in flight — flashing a uuid and then
  // replacing it with a name is exactly the raw-id display this tab set out to
  // remove. The id appears only once the lookup has actually failed.
  const [modelName, setModelName] = useState<string | null>(null)
  const [modelSettled, setModelSettled] = useState(false)
  useEffect(() => {
    let cancelled = false
    setModelName(null)
    setModelSettled(false)
    ;(async () => {
      try {
        const raw = await getDeviceModel(device.deviceModelId)
        const parsed = getDeviceModelResponseSchema.safeParse(raw)
        if (!cancelled && parsed.success) {
          setModelName(parsed.data.device_model.name)
        }
      } catch {
        // ignore — the id is shown instead
      } finally {
        if (!cancelled) setModelSettled(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [device.deviceModelId])

  function commitName() {
    const trimmed = name.trim()
    const parsed = updateDeviceSchema.safeParse({ name: trimmed })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input")
      setName(device.name ?? "")
      return
    }
    if (trimmed === (device.name ?? "")) {
      // Snap the input back to the stored value (e.g. trimmed whitespace).
      setName(device.name ?? "")
      return
    }
    commit(NAME_KEY, { name: trimmed === "" ? null : trimmed })
  }

  async function handleDelete() {
    try {
      await deleteDevice(device.id)
    } catch (err) {
      toast.error((err as Error).message)
      return
    }
    toast.success("Device deleted")
    setDeleteOpen(false)
    navigate({ to: "/devices" })
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {/* One narrow column for the single editable field, two for the eight
          read-only rows — a 50/50 split leaves the Name card mostly empty.
          `items-start` stops the short card stretching to the tall one. */}
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Identification</CardTitle>
            <CardDescription>
              How this device is labelled across the app.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                commitName()
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={NAME_KEY}>Name</FieldLabel>
                  <Input
                    id={NAME_KEY}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={commitName}
                    placeholder={device.serial}
                    maxLength={MAX_NAME_LENGTH}
                    disabled={isPending(NAME_KEY)}
                  />
                  <FieldDescription>
                    Falls back to the serial number when left blank. Saved
                    automatically.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Information</CardTitle>
            <CardDescription>
              Read-only device identifiers and timestamps.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
              <InfoRow label="Serial" value={device.serial} mono />
              <InfoRow
                label="Model"
                value={modelName ?? (modelSettled ? device.deviceModelId : "—")}
                mono={modelName === null && modelSettled}
              />
              <InfoRow label="Device ID" value={device.id} mono />
              <InfoRow
                label="Firmware Ver"
                value={device.firmwareVersion ?? "—"}
                mono
              />
              {/* Reported by the device, never set from here: a box left in
                  `sim` publishes synthetic data, so it has to be visible — but
                  switching a fielded device to sim remotely would silently
                  replace real data with simulated data. */}
              <InfoRow
                label="Agent mode"
                value={
                  agentMode === null ? (
                    "—"
                  ) : (
                    <Badge
                      variant={agentMode === "sim" ? "destructive" : "outline"}
                    >
                      {agentMode === "sim" ? "Simulated" : "Real"}
                    </Badge>
                  )
                }
              />
              {/* Status is machine-managed (telemetry ingest / LWT / the
                  offline sweeper) — it is reported here, never set here. */}
              <InfoRow
                label="Status"
                value={
                  <Badge variant="outline" className="capitalize">
                    {device.status}
                  </Badge>
                }
              />
              <InfoRow
                label="Last seen"
                value={formatTimestamp(device.lastSeenAt)}
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
          </CardContent>
        </Card>
      </div>

      {/* The identity card is where certificate management (view / rotate)
          lands later — see the plan's phase-5 §5d. Its actions area is left
          free deliberately. */}
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
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-3">
              <InfoRow label="Thing name" value={identity.iotThingName} mono />
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

      {/* Action in the header rather than a content row of its own: one button
          under a two-line header leaves a card of mostly padding. */}
      <Card className="ring-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Permanently delete this device and all of its data.
          </CardDescription>
          <CardAction>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              Delete device
            </Button>
          </CardAction>
        </CardHeader>
      </Card>

      <DeleteDeviceDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        deviceName={device.name ?? device.serial}
        onConfirm={handleDelete}
      />
    </div>
  )
}
