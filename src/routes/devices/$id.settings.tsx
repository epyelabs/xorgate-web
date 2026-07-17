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
  FieldContent,
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
import { Switch } from "@/components/ui/switch"
import { DataTable, type DataTableColumn } from "@/components/data-table"
import {
  ApiError,
  deleteDevice,
  getDevice,
  getDeviceIdentity,
  getKvsChannels,
  updateDevice,
  type ActiveStreamsViewType,
  type Device,
  type DeviceIdentity,
  type DeviceStatus,
  type ImuMount,
  type ImuView,
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

const VIEW_TYPE_OPTIONS: { value: ActiveStreamsViewType; label: string }[] = [
  { value: "card", label: "Card View (Default)" },
  { value: "map", label: "Map View" },
]

const kvsChannelColumns: DataTableColumn<KvsChannel>[] = [
  {
    id: "stream",
    header: "Stream",
    cellClassName: "font-mono",
    cell: (channel) => channel.streamKey,
  },
  {
    id: "channel",
    header: "Channel",
    cellClassName: "font-mono",
    cell: (channel) => channel.channelName,
  },
  {
    id: "region",
    header: "Region",
    cell: (channel) => channel.region,
  },
]

// Defaults shown when the device has no stored IMU settings yet. The camera
// numbers mirror the orientation view's built-in 3/4 angle.
const DEFAULT_IMU_MOUNT: ImuMount = {
  enabled: false,
  rollDeg: 0,
  pitchDeg: 0,
  yawDeg: 0,
}
const DEFAULT_IMU_VIEW: ImuView = { azimuthDeg: 45, elevationDeg: 24 }

function parseAngle(s: string): number | null {
  if (s.trim() === "") return null
  const n = Number(s.trim())
  return Number.isFinite(n) ? n : null
}

function imuMountEqual(a: ImuMount, b: ImuMount): boolean {
  return (
    a.enabled === b.enabled &&
    a.rollDeg === b.rollDeg &&
    a.pitchDeg === b.pitchDeg &&
    a.yawDeg === b.yawDeg
  )
}

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
  const [persistTelemetry, setPersistTelemetry] = useState(false)
  const [autoRecord, setAutoRecord] = useState(false)
  const [gnssAntBias, setGnssAntBias] = useState(false)
  const [viewType, setViewType] = useState<ActiveStreamsViewType>("card")
  // IMU inputs are kept as strings so partial numeric input ("-", "1.") never
  // fights the user; they are parsed on commit and snapped back on bad input.
  const [mountEnabled, setMountEnabled] = useState(false)
  const [mountRoll, setMountRoll] = useState("0")
  const [mountPitch, setMountPitch] = useState("0")
  const [mountYaw, setMountYaw] = useState("0")
  const [camAzimuth, setCamAzimuth] = useState(String(DEFAULT_IMU_VIEW.azimuthDeg))
  const [camElevation, setCamElevation] = useState(
    String(DEFAULT_IMU_VIEW.elevationDeg)
  )
  const [baseline, setBaseline] = useState<{
    name: string
    status: DeviceStatus
    persistTelemetry: boolean
    autoRecord: boolean
    gnssAntBias: boolean
    activeStreamsViewType: ActiveStreamsViewType
    imuMount: ImuMount
    imuView: ImuView
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
        setPersistTelemetry(fetched.persistTelemetry)
        setAutoRecord(fetched.autoRecord)
        setGnssAntBias(fetched.gnssAntBias)
        setViewType(fetched.activeStreamsViewType)
        const mount = fetched.imuMount ?? DEFAULT_IMU_MOUNT
        setMountEnabled(mount.enabled)
        setMountRoll(String(mount.rollDeg))
        setMountPitch(String(mount.pitchDeg))
        setMountYaw(String(mount.yawDeg))
        const view = fetched.imuView ?? DEFAULT_IMU_VIEW
        setCamAzimuth(String(view.azimuthDeg))
        setCamElevation(String(view.elevationDeg))
        setBaseline({
          name: initialName,
          status: fetched.status,
          persistTelemetry: fetched.persistTelemetry,
          autoRecord: fetched.autoRecord,
          gnssAntBias: fetched.gnssAntBias,
          activeStreamsViewType: fetched.activeStreamsViewType,
          imuMount: mount,
          imuView: view,
        })
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
      setViewType(updated.activeStreamsViewType)
      setBaseline({
        name: nextName,
        status: updated.status,
        persistTelemetry: updated.persistTelemetry,
        autoRecord: updated.autoRecord,
        gnssAntBias: updated.gnssAntBias,
        activeStreamsViewType: updated.activeStreamsViewType,
        imuMount: updated.imuMount ?? DEFAULT_IMU_MOUNT,
        imuView: updated.imuView ?? DEFAULT_IMU_VIEW,
      })
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

  // Telemetry persistence toggle. Fires immediately on switch change (not on blur):
  // optimistically flip the switch, persist, and roll back to the saved value on error.
  async function commitPersist(next: boolean) {
    if (saving || baseline === null || next === baseline.persistTelemetry) return
    setPersistTelemetry(next)
    setSaving(true)
    try {
      const res = await updateDevice(id, { persistTelemetry: next })
      const updated = res.device
      setDevice(updated)
      setPersistTelemetry(updated.persistTelemetry)
      setBaseline({ ...baseline, persistTelemetry: updated.persistTelemetry })
      toast.success("Settings saved")
    } catch (err) {
      toast.error((err as Error).message)
      setPersistTelemetry(baseline.persistTelemetry)
    } finally {
      setSaving(false)
    }
  }

  // Auto-record toggle. Same optimistic-flip + rollback-on-error pattern as
  // telemetry persistence. When on, the backend spawns a cloud viewer-recorder
  // for each stream as it goes live (and stops it when the stream drops).
  async function commitAutoRecord(next: boolean) {
    if (saving || baseline === null || next === baseline.autoRecord) return
    setAutoRecord(next)
    setSaving(true)
    try {
      const res = await updateDevice(id, { autoRecord: next })
      const updated = res.device
      setDevice(updated)
      setAutoRecord(updated.autoRecord)
      setBaseline({ ...baseline, autoRecord: updated.autoRecord })
      toast.success("Settings saved")
    } catch (err) {
      toast.error((err as Error).message)
      setAutoRecord(baseline.autoRecord)
    } finally {
      setSaving(false)
    }
  }

  // GPS antenna power (GNSS antenna bias). Same optimistic-flip + rollback-on-
  // error pattern. The backend persists the flag and delivers it to the device
  // as a retained MQTT config message; the modem daemon applies it live.
  async function commitGnssAntBias(next: boolean) {
    if (saving || baseline === null || next === baseline.gnssAntBias) return
    setGnssAntBias(next)
    setSaving(true)
    try {
      const res = await updateDevice(id, { gnssAntBias: next })
      const updated = res.device
      setDevice(updated)
      setGnssAntBias(updated.gnssAntBias)
      setBaseline({ ...baseline, gnssAntBias: updated.gnssAntBias })
      toast.success("Settings saved")
    } catch (err) {
      toast.error((err as Error).message)
      setGnssAntBias(baseline.gnssAntBias)
    } finally {
      setSaving(false)
    }
  }

  // Default Active Streams layout. Same optimistic-select + rollback-on-error
  // pattern as the toggles above. Persisted per-device; the Active Streams tab
  // reads it on next mount.
  async function commitViewType(next: ActiveStreamsViewType) {
    if (saving || baseline === null || next === baseline.activeStreamsViewType)
      return
    setViewType(next)
    setSaving(true)
    try {
      const res = await updateDevice(id, { activeStreamsViewType: next })
      const updated = res.device
      setDevice(updated)
      setViewType(updated.activeStreamsViewType)
      setBaseline({
        ...baseline,
        activeStreamsViewType: updated.activeStreamsViewType,
      })
      toast.success("Settings saved")
    } catch (err) {
      toast.error((err as Error).message)
      setViewType(baseline.activeStreamsViewType)
    } finally {
      setSaving(false)
    }
  }

  // IMU mounting correction. Angle inputs commit on blur, the enable switch
  // immediately; both funnel through here. The backend persists the object and
  // delivers it to the device as a retained MQTT config message; the agent's
  // IMU collector applies it live (published euler becomes vehicle-frame).
  async function commitImuMount(enabled: boolean) {
    if (saving || baseline === null) return
    const rollDeg = parseAngle(mountRoll)
    const pitchDeg = parseAngle(mountPitch)
    const yawDeg = parseAngle(mountYaw)
    if (rollDeg === null || pitchDeg === null || yawDeg === null) {
      toast.error("Mounting offsets must be numbers (degrees)")
      setMountEnabled(baseline.imuMount.enabled)
      setMountRoll(String(baseline.imuMount.rollDeg))
      setMountPitch(String(baseline.imuMount.pitchDeg))
      setMountYaw(String(baseline.imuMount.yawDeg))
      return
    }
    const next: ImuMount = { enabled, rollDeg, pitchDeg, yawDeg }
    if (imuMountEqual(next, baseline.imuMount)) {
      // Snap inputs back to canonical form (e.g. "090" -> "90").
      setMountRoll(String(baseline.imuMount.rollDeg))
      setMountPitch(String(baseline.imuMount.pitchDeg))
      setMountYaw(String(baseline.imuMount.yawDeg))
      return
    }
    setMountEnabled(enabled)
    setSaving(true)
    try {
      const res = await updateDevice(id, { imuMount: next })
      const updated = res.device
      const mount = updated.imuMount ?? DEFAULT_IMU_MOUNT
      setDevice(updated)
      setMountEnabled(mount.enabled)
      setMountRoll(String(mount.rollDeg))
      setMountPitch(String(mount.pitchDeg))
      setMountYaw(String(mount.yawDeg))
      setBaseline({ ...baseline, imuMount: mount })
      toast.success("Settings saved")
    } catch (err) {
      toast.error((err as Error).message)
      setMountEnabled(baseline.imuMount.enabled)
      setMountRoll(String(baseline.imuMount.rollDeg))
      setMountPitch(String(baseline.imuMount.pitchDeg))
      setMountYaw(String(baseline.imuMount.yawDeg))
    } finally {
      setSaving(false)
    }
  }

  // 3D orientation view camera. Cloud-only (nothing is sent to the device);
  // the Streams tab reads it on next mount.
  async function commitImuView() {
    if (saving || baseline === null) return
    const azimuthDeg = parseAngle(camAzimuth)
    const elevationDeg = parseAngle(camElevation)
    if (azimuthDeg === null || elevationDeg === null) {
      toast.error("Camera angles must be numbers (degrees)")
      setCamAzimuth(String(baseline.imuView.azimuthDeg))
      setCamElevation(String(baseline.imuView.elevationDeg))
      return
    }
    const next: ImuView = { azimuthDeg, elevationDeg }
    if (
      next.azimuthDeg === baseline.imuView.azimuthDeg &&
      next.elevationDeg === baseline.imuView.elevationDeg
    ) {
      setCamAzimuth(String(baseline.imuView.azimuthDeg))
      setCamElevation(String(baseline.imuView.elevationDeg))
      return
    }
    setSaving(true)
    try {
      const res = await updateDevice(id, { imuView: next })
      const updated = res.device
      const view = updated.imuView ?? DEFAULT_IMU_VIEW
      setDevice(updated)
      // The backend clamps elevation (±85°); reflect what it stored.
      setCamAzimuth(String(view.azimuthDeg))
      setCamElevation(String(view.elevationDeg))
      setBaseline({ ...baseline, imuView: view })
      toast.success("Settings saved")
    } catch (err) {
      toast.error((err as Error).message)
      setCamAzimuth(String(baseline.imuView.azimuthDeg))
      setCamElevation(String(baseline.imuView.elevationDeg))
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
      {/* Row 1: device settings form (left) + read-only details (right) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>
              Update how this device is identified and its lifecycle status.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {device === null ? (
              error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : (
                <Skeleton className="h-32 w-full" />
              )
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  commit({ name, status })
                }}
              >
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

                  <Field>
                    <FieldLabel htmlFor="device-view-type">
                      Default stream view
                    </FieldLabel>
                    <Select
                      value={viewType}
                      disabled={saving}
                      onValueChange={(v) =>
                        commitViewType(v as ActiveStreamsViewType)
                      }
                    >
                      <SelectTrigger id="device-view-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VIEW_TYPE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      Layout for the Active Streams tab. Saved automatically.
                    </FieldDescription>
                  </Field>

                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel htmlFor="device-persist-telemetry">
                        Save telemetry to database
                      </FieldLabel>
                      <FieldDescription>
                        Off by default. The device keeps streaming for live view
                        either way; enable this to also persist telemetry history.
                      </FieldDescription>
                    </FieldContent>
                    <Switch
                      id="device-persist-telemetry"
                      checked={persistTelemetry}
                      disabled={saving}
                      onCheckedChange={commitPersist}
                    />
                  </Field>

                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel htmlFor="device-auto-record">
                        Auto-record streams
                      </FieldLabel>
                      <FieldDescription>
                        Off by default. When on, a cloud recorder captures each
                        stream to S3 while it is live. You can also start/stop
                        recordings manually from the Active Streams tab.
                      </FieldDescription>
                    </FieldContent>
                    <Switch
                      id="device-auto-record"
                      checked={autoRecord}
                      disabled={saving}
                      onCheckedChange={commitAutoRecord}
                    />
                  </Field>

                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel htmlFor="device-gnss-ant-bias">
                        Power the GPS antenna
                      </FieldLabel>
                      <FieldDescription>
                        Off by default. Active GPS antennas have a built-in
                        amplifier that needs power over the antenna cable; turn
                        this on only when one is fitted. Keep it off for
                        passive antennas.
                      </FieldDescription>
                    </FieldContent>
                    <Switch
                      id="device-gnss-ant-bias"
                      checked={gnssAntBias}
                      disabled={saving}
                      onCheckedChange={commitGnssAntBias}
                    />
                  </Field>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Information</CardTitle>
            <CardDescription>
              Read-only device identifiers and timestamps.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {device === null ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
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
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 2: IMU mounting correction (left) + 3D view camera (right) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>IMU mounting</CardTitle>
            <CardDescription>
              Correct roll, pitch and yaw for how the enclosure is physically
              installed in the vehicle.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {device === null ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <FieldGroup>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="device-imu-mount-enabled">
                      Correct for mounting orientation
                    </FieldLabel>
                    <FieldDescription>
                      Off by default. When on, the device re-expresses roll,
                      pitch and yaw in the vehicle&apos;s frame using the
                      rotation below. The raw quaternion and the sensor&apos;s
                      factory calibration are untouched; already-stored history
                      is not rewritten.
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    id="device-imu-mount-enabled"
                    checked={mountEnabled}
                    disabled={saving}
                    onCheckedChange={(next) => commitImuMount(next)}
                  />
                </Field>

                <Field>
                  <FieldLabel>Enclosure rotation (degrees)</FieldLabel>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">Roll</span>
                      <Input
                        id="device-imu-mount-roll"
                        type="number"
                        step="any"
                        inputMode="decimal"
                        value={mountRoll}
                        disabled={saving}
                        onChange={(e) => setMountRoll(e.target.value)}
                        onBlur={() => commitImuMount(mountEnabled)}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">
                        Pitch
                      </span>
                      <Input
                        id="device-imu-mount-pitch"
                        type="number"
                        step="any"
                        inputMode="decimal"
                        value={mountPitch}
                        disabled={saving}
                        onChange={(e) => setMountPitch(e.target.value)}
                        onBlur={() => commitImuMount(mountEnabled)}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">Yaw</span>
                      <Input
                        id="device-imu-mount-yaw"
                        type="number"
                        step="any"
                        inputMode="decimal"
                        value={mountYaw}
                        disabled={saving}
                        onChange={(e) => setMountYaw(e.target.value)}
                        onBlur={() => commitImuMount(mountEnabled)}
                      />
                    </div>
                  </div>
                  <FieldDescription>
                    How the box is rotated relative to the vehicle, applied as
                    yaw, then pitch, then roll. Examples: mounted sideways
                    (roll and pitch appear swapped) → yaw 90; facing backwards
                    (yaw off by half a turn) → yaw 180; standing on its side →
                    roll 90. Saved automatically; applies live within a couple
                    of seconds.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Orientation view camera</CardTitle>
            <CardDescription>
              Where the camera sits in the 3D orientation view on the Streams
              tab.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {device === null ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <FieldGroup>
                <Field>
                  <FieldLabel>Camera angle (degrees)</FieldLabel>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">
                        Azimuth
                      </span>
                      <Input
                        id="device-imu-view-azimuth"
                        type="number"
                        step="any"
                        inputMode="decimal"
                        value={camAzimuth}
                        disabled={saving}
                        onChange={(e) => setCamAzimuth(e.target.value)}
                        onBlur={() => commitImuView()}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">
                        Elevation
                      </span>
                      <Input
                        id="device-imu-view-elevation"
                        type="number"
                        step="any"
                        inputMode="decimal"
                        value={camElevation}
                        disabled={saving}
                        onChange={(e) => setCamElevation(e.target.value)}
                        onBlur={() => commitImuView()}
                      />
                    </div>
                  </div>
                  <FieldDescription>
                    Azimuth spins the camera around the vehicle (0 = behind, 90
                    = right side); elevation raises it toward top-down (clamped
                    to ±85). Default: 45 / 24. Saved automatically.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 3: IoT identity (left) + Media channels (right), equal height */}
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
              <DataTable
                card={false}
                columns={kvsChannelColumns}
                rows={channels}
                getRowKey={(channel) => channel.streamKey}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 4: Danger zone */}
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
