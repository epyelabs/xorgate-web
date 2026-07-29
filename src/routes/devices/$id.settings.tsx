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
  type LteRecoveryConfig,
  type RecordingConfig,
  type VideoPresetName,
} from "@/lib/api"
import { formatBytes } from "@/components/data-table"
import { useIotTelemetry } from "@/hooks/use-iot-telemetry"
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

// LTE recovery policy options (lte_gnss_recovery plan, R8). Labels describe
// the user-facing tradeoff; the preset numbers live in the field descriptions
// below and in the device daemon (deadzone_profile_params).
const GPS_FIX_RESET_POLICY_OPTIONS: {
  value: NonNullable<LteRecoveryConfig["gpsFixResetPolicy"]>
  label: string
}[] = [
  { value: "defer", label: "Protect position (Default)" },
  { value: "veto-deadzone", label: "Never reset in a dead zone with a fix" },
]

const DEADZONE_PROFILE_OPTIONS: {
  value: NonNullable<LteRecoveryConfig["deadZoneProfile"]>
  label: string
}[] = [
  { value: "conservative", label: "Conservative" },
  { value: "balanced", label: "Balanced (Default)" },
  { value: "aggressive", label: "Aggressive" },
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

// On-device recording (offline recording plan, Phase 5). Display defaults
// mirror the device agent's RECORDING_DEFAULTS (device src/recording/config.ts)
// so a device with recordingConfig null renders exactly what it is doing.
const VIDEO_PRESET_OPTIONS: { value: VideoPresetName; label: string }[] = [
  { value: "1080p30-4mbps", label: "1080p 30 fps · 4 Mbps (best, highest CPU)" },
  { value: "1080p15-2mbps", label: "1080p 15 fps · 2 Mbps (default)" },
  { value: "720p30-2mbps", label: "720p 30 fps · 2 Mbps (smoother motion)" },
  { value: "720p15-2mbps", label: "720p 15 fps · 2 Mbps (lower CPU)" },
  {
    value: "720p15-1mbps",
    label: "720p 15 fps · 1 Mbps (lowest CPU, smallest files)",
  },
]
const RATE_HZ_OPTIONS = [1, 2, 5, 10, 20]
const SEGMENT_SECONDS_OPTIONS = [30, 60, 120, 300]
const RETENTION_GIB_OPTIONS = [2, 5, 10, 20, 50]
const GIB = 1024 ** 3

// Boot power staging (optimize-system-process-cycle plan, Phase 2). Display
// defaults mirror the device agent's RECORDING_DEFAULTS.
const BOOT_DEFER_OPTIONS: {
  value: "auto" | "always" | "off"
  label: string
}[] = [
  { value: "auto", label: "Auto — only on constrained power (default)" },
  { value: "always", label: "Always — stage every boot" },
  { value: "off", label: "Off — start everything immediately" },
]
const BOOT_DEFER_MAX_SECS_OPTIONS = [30, 60, 90, 120, 180]

interface ResolvedRecording {
  telemetryEnabled: boolean
  rateHz: number
  videoEnabled: boolean
  preset: VideoPresetName
  segmentSeconds: number
  bootDefer: "auto" | "always" | "off"
  bootDeferMaxSecs: number
  bootDeferMinBudgetMa: number | undefined
  spawnStaggerSecs: number | undefined
  uploadMode: "auto" | "off"
  maxBytes: number
  minFreeBytes: number | undefined
  powerSheddingEnabled: boolean
  // Raw namespace, preserved verbatim: the threshold knobs are edited via the
  // API / field-tuning loop, not this card.
  powerShedding: RecordingConfig["powerShedding"]
}

function resolveRecording(cfg: RecordingConfig | null): ResolvedRecording {
  return {
    telemetryEnabled: cfg?.telemetry?.enabled ?? false,
    rateHz: cfg?.telemetry?.rateHz ?? 10,
    videoEnabled: cfg?.video?.enabled ?? false,
    preset: cfg?.video?.preset ?? "1080p15-2mbps",
    segmentSeconds: cfg?.video?.segmentSeconds ?? 60,
    bootDefer: cfg?.video?.bootDefer ?? "auto",
    bootDeferMaxSecs: cfg?.video?.bootDeferMaxSecs ?? 90,
    bootDeferMinBudgetMa: cfg?.video?.bootDeferMinBudgetMa,
    spawnStaggerSecs: cfg?.video?.spawnStaggerSecs,
    uploadMode: cfg?.upload?.mode ?? "auto",
    maxBytes: cfg?.retention?.maxBytes ?? 10 * GIB,
    minFreeBytes: cfg?.retention?.minFreeBytes,
    powerSheddingEnabled: cfg?.powerShedding?.enabled ?? true,
    powerShedding: cfg?.powerShedding,
  }
}

// The PUT always sends the complete namespace so the stored config (and the
// retained copy the device converges on) is self-contained after first touch.
function buildRecordingConfig(r: ResolvedRecording): RecordingConfig {
  return {
    telemetry: { enabled: r.telemetryEnabled, rateHz: r.rateHz },
    video: {
      enabled: r.videoEnabled,
      preset: r.preset,
      segmentSeconds: r.segmentSeconds,
      bootDefer: r.bootDefer,
      bootDeferMaxSecs: r.bootDeferMaxSecs,
      // Preserve threshold knobs someone set out-of-band (API / field-tuning
      // loop); the card doesn't edit them.
      ...(r.bootDeferMinBudgetMa !== undefined
        ? { bootDeferMinBudgetMa: r.bootDeferMinBudgetMa }
        : {}),
      ...(r.spawnStaggerSecs !== undefined
        ? { spawnStaggerSecs: r.spawnStaggerSecs }
        : {}),
    },
    upload: { mode: r.uploadMode },
    retention: {
      maxBytes: r.maxBytes,
      // Preserve a minFreeBytes someone set out-of-band; the card doesn't edit it.
      ...(r.minFreeBytes !== undefined ? { minFreeBytes: r.minFreeBytes } : {}),
    },
    // Preserve shedding thresholds set out-of-band (field-tuning loop); the
    // card only edits the master switch.
    powerShedding: { ...(r.powerShedding ?? {}), enabled: r.powerSheddingEnabled },
  }
}

// Select options including a stored value that isn't in the preset list (e.g.
// set via the API) so the select never displays a value it doesn't contain.
function withCurrent(options: number[], current: number): number[] {
  return options.includes(current)
    ? options
    : [...options, current].sort((a, b) => a - b)
}

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
  // On-device recording config, optimistic (null = never configured — the
  // controls then show the device defaults).
  const [recConfig, setRecConfig] = useState<RecordingConfig | null>(null)
  // LTE recovery policy, optimistic (null = never configured — the selects
  // then show the device defaults: defer / balanced).
  const [lteRecovery, setLteRecovery] = useState<LteRecoveryConfig | null>(null)
  const [baseline, setBaseline] = useState<{
    name: string
    status: DeviceStatus
    gnssAntBias: boolean
    activeStreamsViewType: ActiveStreamsViewType
    imuMount: ImuMount
    imuView: ImuView
    recordingConfig: RecordingConfig | null
    lteRecoveryConfig: LteRecoveryConfig | null
  } | null>(null)
  const [saving, setSaving] = useState(false)

  // Live payload feed for the reported-state hint (what the device is actually
  // doing, vs. what we asked for).
  const { recording: reportedRecording, media: reportedMedia } =
    useIotTelemetry(id)

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
        setRecConfig(fetched.recordingConfig)
        setLteRecovery(fetched.lteRecoveryConfig)
        setBaseline({
          name: initialName,
          status: fetched.status,
          gnssAntBias: fetched.gnssAntBias,
          activeStreamsViewType: fetched.activeStreamsViewType,
          imuMount: mount,
          imuView: view,
          recordingConfig: fetched.recordingConfig,
          lteRecoveryConfig: fetched.lteRecoveryConfig,
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
      setRecConfig(updated.recordingConfig)
      setLteRecovery(updated.lteRecoveryConfig)
      setBaseline({
        name: nextName,
        status: updated.status,
        gnssAntBias: updated.gnssAntBias,
        activeStreamsViewType: updated.activeStreamsViewType,
        imuMount: updated.imuMount ?? DEFAULT_IMU_MOUNT,
        imuView: updated.imuView ?? DEFAULT_IMU_VIEW,
        recordingConfig: updated.recordingConfig,
        lteRecoveryConfig: updated.lteRecoveryConfig,
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

  // LTE recovery policy (lte_gnss_recovery plan, R8). Same optimistic-select +
  // rollback-on-error pattern. The backend persists the object and delivers it
  // to the device as a retained MQTT config message; the modem daemon reads it
  // live at its next recovery decision — no device restart.
  async function commitLteRecovery(patch: Partial<LteRecoveryConfig>) {
    if (saving || baseline === null) return
    const next: LteRecoveryConfig = { ...(lteRecovery ?? {}), ...patch }
    if (JSON.stringify(next) === JSON.stringify(baseline.lteRecoveryConfig ?? {})) return
    setLteRecovery(next)
    setSaving(true)
    try {
      const res = await updateDevice(id, { lteRecoveryConfig: next })
      const updated = res.device
      setDevice(updated)
      setLteRecovery(updated.lteRecoveryConfig)
      setBaseline({ ...baseline, lteRecoveryConfig: updated.lteRecoveryConfig })
      toast.success("Settings saved")
    } catch (err) {
      toast.error((err as Error).message)
      setLteRecovery(baseline.lteRecoveryConfig)
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

  // On-device recording. Every control commits the COMPLETE `recording`
  // namespace (see buildRecordingConfig) with the one field changed — same
  // optimistic-flip + rollback-on-error pattern as the toggles above. The
  // backend validates (closed preset table, bounded numbers), persists, and
  // delivers it to the device as retained MQTT config; the agent applies it
  // live within ~5 s.
  async function commitRecording(mutate: (r: ResolvedRecording) => void) {
    if (saving || baseline === null) return
    const next = resolveRecording(recConfig)
    mutate(next)
    const nextCfg = buildRecordingConfig(next)
    if (
      JSON.stringify(nextCfg) ===
      JSON.stringify(buildRecordingConfig(resolveRecording(recConfig)))
    ) {
      // Nothing actually changed (and the stored config is already complete).
      if (recConfig !== null) return
    }
    setRecConfig(nextCfg)
    setSaving(true)
    try {
      const res = await updateDevice(id, { recordingConfig: nextCfg })
      const updated = res.device
      setDevice(updated)
      setRecConfig(updated.recordingConfig)
      setBaseline({ ...baseline, recordingConfig: updated.recordingConfig })
      toast.success("Settings saved")
    } catch (err) {
      toast.error((err as Error).message)
      setRecConfig(baseline.recordingConfig)
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

  const rec = resolveRecording(recConfig)
  const reportedVideo = reportedMedia?.recording?.value === true
  // Reported-vs-configured mismatch: only meaningful once we've heard from the
  // device AND the cloud actually manages the config (recConfig non-null).
  const reportedMismatch =
    reportedRecording !== null &&
    recConfig !== null &&
    (reportedRecording.enabled !== rec.telemetryEnabled ||
      reportedVideo !== rec.videoEnabled)

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

                  <Field>
                    <FieldLabel htmlFor="device-gps-fix-reset-policy">
                      Cellular recovery with a GPS fix
                    </FieldLabel>
                    <Select
                      value={lteRecovery?.gpsFixResetPolicy ?? "defer"}
                      disabled={saving}
                      onValueChange={(v) =>
                        commitLteRecovery({
                          gpsFixResetPolicy:
                            v as NonNullable<LteRecoveryConfig["gpsFixResetPolicy"]>,
                        })
                      }
                    >
                      <SelectTrigger id="device-gps-fix-reset-policy">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GPS_FIX_RESET_POLICY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      A full modem reset restarts GPS from scratch. Protect
                      position: allow a reset only after 30+ minutes without
                      cellular (default). Protect harder: never reset while
                      parked out of coverage with a GPS fix. Applied by the
                      device without a restart.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="device-deadzone-profile">
                      Out-of-coverage recovery pace
                    </FieldLabel>
                    <Select
                      value={lteRecovery?.deadZoneProfile ?? "balanced"}
                      disabled={saving}
                      onValueChange={(v) =>
                        commitLteRecovery({
                          deadZoneProfile:
                            v as NonNullable<LteRecoveryConfig["deadZoneProfile"]>,
                        })
                      }
                    >
                      <SelectTrigger id="device-deadzone-profile">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DEADZONE_PROFILE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      How hard the device works to restore cellular in a dead
                      zone. Conservative: gentle radio nudges (15 min–2 h),
                      never a modem reset. Balanced (default): nudges 10–60
                      min apart, reset only after 3 failed radio cycles.
                      Aggressive: nudges 10–20 min apart, reset after 1
                      failed cycle. Applied by the device without a restart.
                    </FieldDescription>
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

      {/* Row 3: on-device recording (offline recording plan, Phase 5) */}
      <Card>
        <CardHeader>
          <CardTitle>Record on device</CardTitle>
          <CardDescription>
            Capture telemetry and video on the device itself — recording
            continues while offline and uploads to the cloud whenever the
            device is connected. Recorded runs appear under Media Recordings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {device === null ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <FieldGroup>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="device-rec-telemetry">
                    Record telemetry on device
                  </FieldLabel>
                  <FieldDescription>
                    Off by default. Samples sensors up to the rate below
                    (higher than the 1&nbsp;Hz live feed) and becomes the
                    authoritative telemetry history once uploaded.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="device-rec-telemetry"
                  checked={rec.telemetryEnabled}
                  disabled={saving}
                  onCheckedChange={(next) =>
                    commitRecording((r) => {
                      r.telemetryEnabled = next
                    })
                  }
                />
              </Field>

              {rec.telemetryEnabled ? (
                <Field>
                  <FieldLabel htmlFor="device-rec-rate">Sample rate</FieldLabel>
                  <Select
                    value={String(rec.rateHz)}
                    disabled={saving}
                    onValueChange={(v) =>
                      commitRecording((r) => {
                        r.rateHz = Number(v)
                      })
                    }
                  >
                    <SelectTrigger id="device-rec-rate">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {withCurrent(RATE_HZ_OPTIONS, rec.rateHz).map((hz) => (
                        <SelectItem key={hz} value={String(hz)}>
                          {hz} Hz
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Motion (IMU) records at this rate; GPS and system metrics
                    record at their natural once-per-second pace.
                  </FieldDescription>
                </Field>
              ) : null}

              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="device-rec-video">
                    Record video on device
                  </FieldLabel>
                  <FieldDescription>
                    Off by default. Records every camera continuously in short
                    segments. Note: turning this on or off (or changing the
                    quality) briefly restarts the live stream — an open live
                    view pauses for a few seconds and reconnects on its own.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="device-rec-video"
                  checked={rec.videoEnabled}
                  disabled={saving}
                  onCheckedChange={(next) =>
                    commitRecording((r) => {
                      r.videoEnabled = next
                    })
                  }
                />
              </Field>

              {rec.videoEnabled ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="device-rec-preset">Quality</FieldLabel>
                    <Select
                      value={rec.preset}
                      disabled={saving}
                      onValueChange={(v) =>
                        commitRecording((r) => {
                          r.preset = v as VideoPresetName
                        })
                      }
                    >
                      <SelectTrigger id="device-rec-preset">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VIDEO_PRESET_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="device-rec-segment">
                      Segment length
                    </FieldLabel>
                    <Select
                      value={String(rec.segmentSeconds)}
                      disabled={saving}
                      onValueChange={(v) =>
                        commitRecording((r) => {
                          r.segmentSeconds = Number(v)
                        })
                      }
                    >
                      <SelectTrigger id="device-rec-segment">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {withCurrent(
                          SEGMENT_SECONDS_OPTIONS,
                          rec.segmentSeconds
                        ).map((s) => (
                          <SelectItem key={s} value={String(s)}>
                            {s < 60 ? `${s} seconds` : `${s / 60} minute${s > 60 ? "s" : ""}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="device-rec-bootdefer">
                      Boot power staging
                    </FieldLabel>
                    <Select
                      value={rec.bootDefer}
                      disabled={saving}
                      onValueChange={(v) =>
                        commitRecording((r) => {
                          r.bootDefer = v as "auto" | "always" | "off"
                        })
                      }
                    >
                      <SelectTrigger id="device-rec-bootdefer">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BOOT_DEFER_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      Waits for the cellular modem to settle after power-on
                      before starting the video encoders, easing the load on a
                      weak power supply. Live streaming stays available while
                      waiting.
                    </FieldDescription>
                  </Field>
                  {rec.bootDefer !== "off" ? (
                    <Field>
                      <FieldLabel htmlFor="device-rec-bootdefer-cap">
                        Staging time limit
                      </FieldLabel>
                      <Select
                        value={String(rec.bootDeferMaxSecs)}
                        disabled={saving}
                        onValueChange={(v) =>
                          commitRecording((r) => {
                            r.bootDeferMaxSecs = Number(v)
                          })
                        }
                      >
                        <SelectTrigger id="device-rec-bootdefer-cap">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {withCurrent(
                            BOOT_DEFER_MAX_SECS_OPTIONS,
                            rec.bootDeferMaxSecs
                          ).map((s) => (
                            <SelectItem key={s} value={String(s)}>
                              {s < 60
                                ? `${s} seconds`
                                : `${s / 60} minute${s > 60 ? "s" : ""}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        Recording always starts within this bound, even if the
                        modem never settles.
                      </FieldDescription>
                    </Field>
                  ) : null}
                </div>
              ) : null}

              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="device-rec-powershed">
                    Power protection
                  </FieldLabel>
                  <FieldDescription>
                    On a failing power supply the device automatically pauses
                    live streaming first, then video recording, and resumes
                    once the supply recovers — instead of crashing mid-drive.
                    Recommended on.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="device-rec-powershed"
                  checked={rec.powerSheddingEnabled}
                  disabled={saving}
                  onCheckedChange={(next) =>
                    commitRecording((r) => {
                      r.powerSheddingEnabled = next
                    })
                  }
                />
              </Field>

              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="device-rec-upload">
                    Upload automatically
                  </FieldLabel>
                  <FieldDescription>
                    Send recordings to the cloud whenever the device is online
                    (oldest first; local copies are removed once safely
                    uploaded). Turn off to keep recordings on the device only.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="device-rec-upload"
                  checked={rec.uploadMode === "auto"}
                  disabled={saving}
                  onCheckedChange={(next) =>
                    commitRecording((r) => {
                      r.uploadMode = next ? "auto" : "off"
                    })
                  }
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="device-rec-retention">
                  Storage limit
                </FieldLabel>
                <Select
                  value={String(rec.maxBytes)}
                  disabled={saving}
                  onValueChange={(v) =>
                    commitRecording((r) => {
                      r.maxBytes = Number(v)
                    })
                  }
                >
                  <SelectTrigger id="device-rec-retention">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {withCurrent(
                      RETENTION_GIB_OPTIONS.map((g) => g * GIB),
                      rec.maxBytes
                    ).map((b) => (
                      <SelectItem key={b} value={String(b)}>
                        {formatBytes(b)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Cap on recordings kept on the device. When full, the oldest
                  not-yet-uploaded segments are deleted first — the sessions
                  list will flag any dropped data.
                </FieldDescription>
              </Field>

              {/* Reported state from the live 1 Hz payload: shows whether the
                  device has actually applied what was asked (poor man's
                  desired-vs-reported until the config-shadow plan lands). */}
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {reportedRecording === null ? (
                  "Waiting for a live status report from the device… (the device may be offline; settings saved here are delivered when it reconnects)"
                ) : (
                  <>
                    Device reports: telemetry recording{" "}
                    <span className="font-medium">
                      {reportedRecording.enabled ? "on" : "off"}
                    </span>
                    {" · "}video recording{" "}
                    <span className="font-medium">
                      {reportedVideo ? "on" : "off"}
                    </span>
                    {reportedRecording.backlogSegments > 0 ? (
                      <>
                        {" · "}
                        {formatBytes(reportedRecording.backlogBytes)} awaiting
                        upload ({reportedRecording.backlogSegments} segments
                        {reportedRecording.uploading ? ", uploading" : ""})
                      </>
                    ) : null}
                    {reportedRecording.droppedSegments > 0 ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        {" · "}
                        {reportedRecording.droppedSegments} segments deleted
                        before upload (disk full)
                      </span>
                    ) : null}
                    {reportedMismatch ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        {" — the device has not applied the saved settings yet"}
                      </span>
                    ) : null}
                  </>
                )}
              </div>
            </FieldGroup>
          )}
        </CardContent>
      </Card>

      {/* Row 4: IoT identity (left) + Media channels (right), equal height */}
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

      {/* Row 5: Danger zone */}
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
