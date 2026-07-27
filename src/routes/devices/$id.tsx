import { useEffect, useState } from "react"
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router"
import { toast } from "sonner"
import { EllipsisVerticalIcon, PowerIcon, ZapIcon } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { StatusDot } from "@/components/data-table/status-dot"
import { DeviceBacklogBadge } from "@/components/device-backlog-badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ApiError,
  apiErrorMessage,
  getDevice,
  getDeviceModel,
  powerOffDevice,
  rebootDevice,
  type Device,
  type DeviceModel,
  type DeviceStatus,
} from "@/lib/api"
import { DeviceModelDialog } from "./-components/device-model-dialog"
import { PowerOffDeviceDialog } from "./-components/power-off-device-dialog"
import { RebootDeviceDialog } from "./-components/reboot-device-dialog"
import {
  DeviceAlertsButton,
  type DeviceAlert,
} from "./-components/device-alerts"
import {
  useIotTelemetry,
  type LatestReading,
} from "@/hooks/use-iot-telemetry"
import { decodeThrottleBits } from "@/lib/telemetry-meta"
import {
  getDeviceModelResponseSchema,
  getDeviceResponseSchema,
} from "@/lib/schemas"
import { formatRelative } from "@/lib/relative-time"
import { useAuthStore } from "@/store/auth"
import { useBreadcrumbStore } from "@/store/breadcrumb"

// Layout route for /devices/$id. Owns the device fetch and renders the shared
// page header + tab bar; the active tab's content (live / history) renders
// through the Outlet below. Because this layout stays mounted while only the
// leaf swaps, the header persists across tab switches without refetching.
export const Route = createFileRoute("/devices/$id")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DeviceLayout,
})

const DEVICE_STATUS_COLOR: Record<DeviceStatus, string> = {
  online: "bg-emerald-500",
  offline: "bg-amber-500",
  provisioned: "bg-sky-500",
  decommissioned: "bg-zinc-400",
}

// Folds the online/offline badge and the "Last seen" line into a single status
// phrase: a live device just reads "Online" (last-seen is now, so it's noise),
// while everything else surfaces the recency that actually matters.
function deviceStatusLabel(device: Device): string {
  switch (device.status) {
    case "online":
      return "Online"
    case "offline":
      return `Last seen ${formatRelative(device.lastSeenAt)}`
    case "provisioned":
      return "Provisioned"
    case "decommissioned":
      return "Decommissioned"
  }
}

function deviceInitials(device: Device): string {
  const source = device.name ?? device.serial
  return source.slice(0, 2).toUpperCase()
}

// Throttle-cause colors, most severe first — the icon takes the color of the
// worst active bit. Undervoltage is the brownout precursor (red); "currently
// throttled" means the firmware is already intervening (orange); a frequency
// cap or soft temperature limit degrades performance but isn't power-critical
// (amber / yellow).
const THROTTLE_SEVERITY: Array<[number, string]> = [
  [0x1, "text-red-500"], // undervoltage
  [0x4, "text-orange-500"], // currently throttled
  [0x2, "text-amber-500"], // ARM frequency capped
  [0x8, "text-yellow-500"], // soft temp limit
]

// Lightning bolt beside the online/offline status while the live throttle
// bitmask (system.throttled) is non-zero. Hidden entirely at 0 — power trouble
// is the exception, not a state worth advertising when absent.
function ThrottleIndicator({
  latest,
}: {
  latest: Record<string, LatestReading>
}) {
  const mask = latest["system.throttled"]?.value
  if (typeof mask !== "number" || mask <= 0) return null
  const color =
    THROTTLE_SEVERITY.find(([bit]) => mask & bit)?.[1] ?? "text-amber-500"
  return (
    <ZapIcon
      className={`size-3.5 shrink-0 ${color}`}
      aria-label={`Power throttling: ${decodeThrottleBits(mask).join(", ")}`}
    >
      <title>{`Power throttling: ${decodeThrottleBits(mask).join(", ")}`}</title>
    </ZapIcon>
  )
}

const TAB_VALUES = [
  "overview",
  "streams",
  "telemetry",
  "media",
  "workflows",
  "benchmark",
  "settings",
  // No trigger of its own (entered from the Media tab) — listed so the tab
  // bar doesn't fall back to highlighting Overview while replaying.
  "replay",
] as const

function DeviceLayout() {
  const { id } = Route.useParams()
  const { pathname } = useLocation()
  const segment = pathname.split("/").pop() ?? ""
  const activeTab = (TAB_VALUES as readonly string[]).includes(segment)
    ? segment
    : "overview"
  const [device, setDevice] = useState<Device | null>(null)
  const [deviceModel, setDeviceModel] = useState<DeviceModel | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [rebootDialogOpen, setRebootDialogOpen] = useState(false)
  const [powerOffDialogOpen, setPowerOffDialogOpen] = useState(false)

  // Live payload feed for the header alert button. Alerts are derived, not
  // stored: each source contributes zero or more DeviceAlerts per render;
  // dismissal/acknowledgment state lives inside DeviceAlertsButton.
  // (This adds a second MQTT connection on tabs that mount their own feed —
  // acceptable for now; a shared per-device feed is a future refactor.)
  const { recording, latest } = useIotTelemetry(id)
  const alerts: DeviceAlert[] = []
  if (recording && recording.droppedSegments > 0) {
    alerts.push({
      id: "recording-dropped-segments",
      severity: "warning",
      title: `${recording.droppedSegments} recorded segment${
        recording.droppedSegments === 1 ? "" : "s"
      } deleted before upload`,
      description:
        "The device hit its recording storage limit and deleted the oldest " +
        "not-yet-uploaded segments to make room. That footage is gone. " +
        "Consider raising the storage limit in Settings or checking why " +
        "uploads are not keeping up. The count is cumulative for this device.",
      // Cumulative counter as the watermark: dismissing hides the alert at
      // the current count; it re-fires only when MORE segments get dropped.
      watermark: recording.droppedSegments,
    })
  }

  // Commands are published non-retained, so an offline device would never
  // receive them — the backend rejects those with a 409. Gate the controls here
  // too, so the UI never offers an action that cannot land.
  const canCommand = device?.status === "online"
  const commandHint = !device
    ? undefined
    : canCommand
      ? undefined
      : `Device is ${device.status}. It must be online to accept commands.`

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const raw = await getDevice(id)
        const parsed = getDeviceResponseSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error("Unexpected /devices/:id response shape")
        }
        if (!cancelled) {
          const fetched = parsed.data.device
          setDevice(fetched)
          useBreadcrumbStore
            .getState()
            .setDeviceName(fetched.name ?? fetched.serial)

          // The model feeds the header subtitle and the model dialog.
          // Best-effort: a failure here must not block the header, so swallow
          // errors.
          try {
            const rawModel = await getDeviceModel(fetched.deviceModelId)
            const parsedModel = getDeviceModelResponseSchema.safeParse(rawModel)
            if (parsedModel.success && !cancelled) {
              const m = parsedModel.data.device_model
              // The schema leaves these optional; the DeviceModel type wants
              // them present, so normalize undefined -> null.
              setDeviceModel({
                ...m,
                ioCapabilities: m.ioCapabilities ?? null,
                firmwareChannel: m.firmwareChannel ?? null,
              })
            }
          } catch {
            // ignore
          }
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          if (!cancelled) setNotFound(true)
          return
        }
        const message = (err as Error).message
        toast.error(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  // Clear the published name when leaving the device (or switching to a
  // different one) so the breadcrumb never shows a stale name.
  useEffect(() => {
    return () => {
      useBreadcrumbStore.getState().setDeviceName(null)
    }
  }, [id])

  if (notFound) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <p className="text-sm text-muted-foreground">Device not found.</p>
      </div>
    )
  }

  return (
    // Fixed to the viewport (SidebarInset is only `min-h-svh`, so a plain
    // `flex-1` would grow the page). The header stays put and each tab's content
    // scrolls inside the wrapper below instead of the whole page scrolling. The
    // page gutter lives on that scroll wrapper (not here) so card ring-outlines
    // sit inside its clip edge and stay visible on every side.
    <div className="flex h-[calc(100svh-4rem)] min-h-0 min-w-0 flex-col group-has-data-[collapsible=icon]/sidebar-wrapper:h-[calc(100svh-3rem)]">
      <div className="flex flex-col gap-3 px-4">
        <header className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar size="sm">
                <AvatarFallback>
                  {device ? deviceInitials(device) : "—"}
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="text-md truncate font-semibold tracking-tight">
                  {device?.name ?? device?.serial ?? "Device"}
                </h1>
                {device ? (
                  <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    {deviceModel ? (
                      <>
                        <span
                          aria-hidden
                          className="h-3 w-px shrink-0 bg-border"
                        />
                        <button
                          type="button"
                          onClick={() => setModelDialogOpen(true)}
                          className="truncate underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
                        >
                          {deviceModel.name}
                        </button>
                      </>
                    ) : null}
                    <span aria-hidden className="h-3 w-px shrink-0 bg-border" />
                    <StatusDot
                      color={DEVICE_STATUS_COLOR[device.status]}
                      label={deviceStatusLabel(device)}
                      pulse={device.status === "online"}
                    />
                    <ThrottleIndicator latest={latest} />
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">{id}</span>
                )}
              </div>
            </div>

            {/* `title` sits on the wrapper, not the buttons: a disabled button
                fires no pointer events, so a tooltip on it never shows. The
                alerts button sits outside that wrapper — it must stay active
                (and un-tooltipped) even when the device can't take commands. */}
            <div className="flex items-center gap-2 self-start">
              <DeviceAlertsButton deviceId={id} alerts={alerts} />
              <div
                className="flex items-center gap-2"
                title={commandHint}
              >
              <Button
                variant="outline"
                size="sm"
                disabled={!canCommand}
                onClick={() => setRebootDialogOpen(true)}
              >
                Reboot Device
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={!canCommand}
                    aria-label="More device actions"
                  >
                    <EllipsisVerticalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setPowerOffDialogOpen(true)}
                  >
                    <PowerIcon />
                    Power off
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              </div>
            </div>
          </div>

          {/* Commenting this out for now, will need to improve later */}
          {/* {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : device === null ? (
            <Skeleton className="h-4 w-96 max-w-full" />
          ) : (
            <p className="text-xs text-muted-foreground">
              Serial {device.serial} · Model {device.deviceModelId} · fw{" "}
              {device.firmwareVersion ?? "-"} · Last seen{" "}
              {formatTimestamp(device.lastSeenAt)}
            </p>
          )} */}
        </header>

        {/* Tabs left, ambient on-device upload backlog right: the badge costs no
            vertical space here and stays visible from every tab. min-w-0 lets the
            tab list shrink/scroll on narrow viewports instead of wrapping. */}
        <div className="flex items-center justify-between gap-2 border-b border-border">
          <Tabs value={activeTab} className="min-w-0">
            <TabsList variant="line">
              <TabsTrigger value="overview" asChild>
                <Link to="/devices/$id/overview" params={{ id }}>
                  Overview
                </Link>
              </TabsTrigger>
              <TabsTrigger value="streams" asChild>
                <Link to="/devices/$id/streams" params={{ id }}>
                  Active Streams
                </Link>
              </TabsTrigger>
              <TabsTrigger value="telemetry" asChild>
                <Link to="/devices/$id/telemetry" params={{ id }}>
                  Telemetry History
                </Link>
              </TabsTrigger>
              <TabsTrigger value="media" asChild>
                <Link to="/devices/$id/media" params={{ id }}>
                  Media Recordings
                </Link>
              </TabsTrigger>
              <TabsTrigger value="workflows" asChild>
                <Link to="/devices/$id/workflows" params={{ id }}>
                  Workflows
                </Link>
              </TabsTrigger>
              {/* Temporarily hide this tab */}
              {/* <TabsTrigger value="benchmark" asChild>
                <Link to="/devices/$id/benchmark" params={{ id }}>
                  Hardware Benchmark
                </Link>
              </TabsTrigger> */}
              <TabsTrigger value="settings" asChild>
                <Link to="/devices/$id/settings" params={{ id }}>
                  Settings
                </Link>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <DeviceBacklogBadge recording={recording} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        <Outlet />
      </div>

      {deviceModel ? (
        <DeviceModelDialog
          open={modelDialogOpen}
          onOpenChange={setModelDialogOpen}
          model={deviceModel}
        />
      ) : null}

      {/* Both commands are fire-and-forget: a 202 means the command reached the
          broker, not that the device acted on it. The device dropping offline
          (and, for reboot, returning) is the real feedback, and it arrives via
          the status badge on its own. On failure the dialog stays open so the
          error is readable and the action is retryable. */}
      {device ? (
        <RebootDeviceDialog
          open={rebootDialogOpen}
          onOpenChange={setRebootDialogOpen}
          deviceName={device.name ?? device.serial}
          onConfirm={async () => {
            try {
              await rebootDevice(id)
              toast.success(
                `Reboot command sent to ${device.name ?? device.serial}`
              )
              setRebootDialogOpen(false)
            } catch (err) {
              toast.error(apiErrorMessage(err))
            }
          }}
        />
      ) : null}

      {device ? (
        <PowerOffDeviceDialog
          open={powerOffDialogOpen}
          onOpenChange={setPowerOffDialogOpen}
          deviceName={device.name ?? device.serial}
          onConfirm={async () => {
            try {
              await powerOffDevice(id)
              toast.success(
                `Power off command sent to ${device.name ?? device.serial}`
              )
              setPowerOffDialogOpen(false)
            } catch (err) {
              toast.error(apiErrorMessage(err))
            }
          }}
        />
      ) : null}
    </div>
  )
}
