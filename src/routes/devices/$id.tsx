import { useEffect, useMemo, useState } from "react"
import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router"
import { requireWorkspace } from "@/lib/auth-guard"
import { toast } from "sonner"
import {
  EllipsisVerticalIcon,
  PlayIcon,
  PowerIcon,
  SearchXIcon,
  ZapIcon,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { StatusDot } from "@/components/data-table/status-dot"
import { StatusScreen } from "@/components/error-screens"
import { DeviceBacklogBadge } from "@/components/device-backlog-badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { xg, xgMessage } from "@/lib/xorgate"
import {
  isXorgateError,
  type Device,
  type DeviceStatus,
  type SimulationHostState,
} from "@xorgate/sdk"
import {
  useDevice,
  useDeviceModel,
  useInvalidateDevices,
} from "@/queries/devices"
import { useLiveDeviceStatus } from "@/store/presence"
import { DevicePresence } from "@/components/device-presence"
import { DeviceStatusChip } from "@/components/device-status-chip"
import { DeviceModelDialog } from "./-components/device-model-dialog"
import { PowerOffDeviceDialog } from "./-components/power-off-device-dialog"
import { RebootDeviceDialog } from "./-components/reboot-device-dialog"
import { RebootSimulationDialog } from "./-components/reboot-simulation-dialog"
import { SimulatedBadge } from "./-components/simulated-badge"
import { useDeviceSimulation } from "@/queries/simulations"
import {
  buildSimulationConfig,
  HOST_STATE_LABELS,
  hostStateTone,
  storedSimulationConfig,
} from "@/lib/device-simulation"
import { useHasPermission } from "@/lib/permissions"
import {
  DeviceAlertsButton,
  type DeviceAlert,
} from "./-components/device-alerts"
import { useLiveTelemetry } from "@xorgate/react"
import type { LatestReading } from "@xorgate/sdk"
import { decodeThrottleBits } from "@/lib/telemetry-meta"
import { formatRelative } from "@/lib/relative-time"
import { useBreadcrumbStore } from "@/store/breadcrumb"

// Layout route for /devices/$id. Owns the device query (and its 20s poll) and
// renders the shared page header + tab bar; the active tab's content renders
// through the Outlet below. The layout stays mounted while only the leaf
// swaps, and the tabs read the SAME query keys, so switching tabs costs no
// request and flashes no skeleton: each leaf renders the cached answer and
// refreshes behind it only once it goes stale.
export const Route = createFileRoute("/devices/$id")({
  beforeLoad: requireWorkspace,
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

const HOST_TONE_CLASS: Record<ReturnType<typeof hostStateTone>, string> = {
  ok: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
  busy: "border-sky-500/50 text-sky-600 dark:text-sky-400",
  off: "border-border text-muted-foreground",
  error: "border-destructive/50 text-destructive",
}

// What the simulator host last said, shown only while a simulated device is
// not online (starting, parked, failed): its status dot alone cannot tell
// "parked by a power off" from "still coming up".
function SimulationHostChip({
  state,
  message,
  powerOnRequested,
}: {
  state: SimulationHostState
  message: string | null
  powerOnRequested: boolean
}) {
  // A start request is acted on at the host's next pass; until then the host
  // still reports the parked state, which would read as "nothing happened".
  const label =
    powerOnRequested && state === "stopped"
      ? "Power on requested"
      : HOST_STATE_LABELS[state]
  return (
    <span
      data-testid="simulation-host-state"
      data-host-state={state}
      title={message ?? undefined}
      className={`rounded-full border px-1.5 py-px text-[0.65rem] font-medium ${
        HOST_TONE_CLASS[hostStateTone(state)]
      }`}
    >
      Simulator: {label}
    </span>
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
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [rebootDialogOpen, setRebootDialogOpen] = useState(false)
  const [powerOffDialogOpen, setPowerOffDialogOpen] = useState(false)

  // The device, polled while this screen is visible so the status badge (and
  // the command gating below) tracks reality without a reload. Seeded from
  // the fleet cache, so arriving from the list paints the header instantly.
  const deviceQuery = useDevice(id, { poll: true })
  const device = deviceQuery.data ?? null
  // The model feeds the header subtitle and the model dialog. Best-effort: a
  // failure here must not block the header.
  const deviceModel = useDeviceModel(device?.deviceModelId).data ?? null
  // Probe-at-claim couldn't pick a model (cm4-support): surfaced as a badge
  // and resolved in the model dialog.
  const needsModel = device?.needsModel ?? false
  const notFound =
    isXorgateError(deviceQuery.error) && deviceQuery.error.status === 404
  const invalidateDevices = useInvalidateDevices()

  // Surface a load failure once, but only when there is nothing to show; a
  // failed background poll keeps the last good header.
  useEffect(() => {
    if (deviceQuery.error && !deviceQuery.data && !notFound) {
      toast.error(xgMessage(deviceQuery.error))
    }
    // The error object identity is stable across renders for one failure.
  }, [deviceQuery.error, deviceQuery.data, notFound])

  // Publish the name for the breadcrumb whenever a fresh answer lands.
  useEffect(() => {
    if (device) {
      useBreadcrumbStore.getState().setDeviceName(device.name ?? device.serial)
    }
  }, [device])

  // Live payload feed for the header alert button. Alerts are derived, not
  // stored: each source contributes zero or more DeviceAlerts per render;
  // dismissal/acknowledgment state lives inside DeviceAlertsButton.
  // (This adds a second MQTT connection on tabs that mount their own feed —
  // acceptable for now; a shared per-device feed is a future refactor.)
  const { recording, latest } = useLiveTelemetry(id)
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

  // Presence overlay: the moment this device publishes a frame, the badge
  // flips online (the polled row catches up within a poll). Going offline is
  // the poll's job; see lib/freshness.ts.
  const watched = useMemo(() => [id], [id])
  const liveDevice = useLiveDeviceStatus(device ?? undefined) ?? null

  // Commands are published non-retained, so an offline device would never
  // receive them — the backend rejects those with a 409. Gate the controls here
  // too, so the UI never offers an action that cannot land. Gated on the
  // presence-overlaid status: a device that is publishing right now can take
  // a command even if the poll hasn't flipped the row yet.
  const canCommand = liveDevice?.status === "online"
  const commandHint = !liveDevice
    ? undefined
    : canCommand
      ? undefined
      : `Device is ${liveDevice.status}. It must be online to accept commands.`

  // Simulated devices (plans/xorgate-device-simulator). `device.simulated` is
  // the server-side fact; the agent's reported mode is never consulted. A sim
  // that is not online is either still starting or parked by a power_off, and
  // commands cannot reach it either way, so its one action is "Power on"
  // (README Q8). The host's report is the progress signal while it comes up.
  const simulated = device?.simulated ?? false
  const canSimulate = useHasPermission("devices:simulate")
  // Set by "Power on", cleared by "Power off"; only meaningful while the
  // device is still not online, so derived rather than reset by an effect.
  const [powerOnClicked, setPowerOnClicked] = useState(false)
  const powerOnRequested = powerOnClicked && !canCommand
  const [poweringOn, setPoweringOn] = useState(false)
  const simulationQuery = useDeviceSimulation(id, {
    enabled: simulated,
    fast: simulated && (!canCommand || powerOnRequested),
  })
  const simulation = simulationQuery.data ?? null
  const currentScenarioId =
    storedSimulationConfig(device?.config)?.scenarioId ??
    simulation?.scenarioId ??
    null
  const canPowerOn = simulated && canSimulate && !canCommand && !!liveDevice

  async function handlePowerOn() {
    setPoweringOn(true)
    try {
      await xg().devices.simulations.start(id)
      setPowerOnClicked(true)
      toast.success(
        `Power on requested for ${device?.name ?? device?.serial ?? "the device"}. The simulator host starts it on its next pass.`
      )
      void simulationQuery.refetch()
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setPoweringOn(false)
    }
  }

  // Clear the published name when leaving the device (or switching to a
  // different one) so the breadcrumb never shows a stale name.
  useEffect(() => {
    return () => {
      useBreadcrumbStore.getState().setDeviceName(null)
    }
  }, [id])

  // Never a dead end. The realistic way to land here is a TRANSFER: the device
  // was handed to another organization while this page was open, and the API
  // answers 404 rather than 403 on purpose — confirming another tenant's
  // resource exists is itself a leak, so this screen must not say "you don't
  // have permission" either. A same-organization move does NOT come here:
  // GET /devices/{id} is organization-wide, so the page keeps working and the
  // Ownership card simply re-renders with the new workspace.
  if (notFound) {
    return (
      <StatusScreen
        icon={<SearchXIcon />}
        code="404"
        title="This device is no longer here"
        description="It has been transferred to another organization, or deleted. Either way it is not in this organization any more, and its recordings and telemetry went with it."
        actions={
          <Button asChild>
            <Link to="/devices">Back to devices</Link>
          </Button>
        }
      />
    )
  }

  return (
    // Fixed to the viewport (SidebarInset is only `min-h-svh`, so a plain
    // `flex-1` would grow the page). The header stays put and each tab's content
    // scrolls inside the wrapper below instead of the whole page scrolling. The
    // page gutter lives on that scroll wrapper (not here) so card ring-outlines
    // sit inside its clip edge and stay visible on every side.
    <div className="flex h-[calc(100svh-4rem)] min-h-0 min-w-0 flex-col group-has-data-[collapsible=icon]/sidebar-wrapper:h-[calc(100svh-3rem)]">
      <DevicePresence deviceIds={watched} />
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
                {simulated ? <SimulatedBadge config={device?.config ?? null} /> : null}
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
                        {needsModel ? (
                          <button
                            type="button"
                            onClick={() => setModelDialogOpen(true)}
                            className="rounded-full border border-amber-500/50 px-1.5 py-px text-[0.65rem] font-medium text-amber-600 dark:text-amber-400"
                            title="The device's hardware probe could not pick a model unambiguously — confirm one here."
                          >
                            needs model
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    <span aria-hidden className="h-3 w-px shrink-0 bg-border" />
                    <StatusDot
                      color={DEVICE_STATUS_COLOR[(liveDevice ?? device).status]}
                      label={deviceStatusLabel(liveDevice ?? device)}
                      pulse={(liveDevice ?? device).status === "online"}
                    />
                    <ThrottleIndicator latest={latest} />
                    {/* The status LED's state while it is not healthy (read
                        straight off the live feed, no caps gate, like the
                        throttle bolt). */}
                    <DeviceStatusChip
                      ledState={latest["system.led_state"]?.value}
                      healthFlags={latest["system.health_flags"]?.value}
                      online={(liveDevice ?? device).status === "online"}
                    />
                    {simulated && !canCommand && simulation ? (
                      <SimulationHostChip
                        state={simulation.hostState}
                        message={simulation.hostMessage}
                        powerOnRequested={powerOnRequested}
                      />
                    ) : null}
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
                    disabled={!canCommand && !canPowerOn}
                    aria-label="More device actions"
                  >
                    <EllipsisVerticalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {/* Simulated devices only: the one action an offline sim
                      takes. Never rendered for real hardware. */}
                  {canPowerOn ? (
                    <DropdownMenuItem
                      disabled={poweringOn}
                      onSelect={() => void handlePowerOn()}
                    >
                      <PlayIcon />
                      Power on
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={!canCommand}
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
              Serial {device.serial} · Model {device.deviceModelId} · agent{" "}
              {device.agentVersion ?? "-"} · Last seen{" "}
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

      {deviceModel && device ? (
        <DeviceModelDialog
          open={modelDialogOpen}
          onOpenChange={setModelDialogOpen}
          model={deviceModel}
          deviceId={device.id}
          needsModel={needsModel}
          onModelChanged={() => invalidateDevices(id)}
        />
      ) : null}

      {/* Both commands are fire-and-forget: a 202 means the command reached the
          broker, not that the device acted on it. The device dropping offline
          (and, for reboot, returning) is the real feedback, and it arrives via
          the status badge on its own. On failure the dialog stays open so the
          error is readable and the action is retryable. */}
      {device && simulated ? (
        <RebootSimulationDialog
          open={rebootDialogOpen}
          onOpenChange={setRebootDialogOpen}
          deviceName={device.name ?? device.serial}
          currentScenarioId={currentScenarioId}
          onConfirm={async (scenarioId) => {
            const label = device.name ?? device.serial
            // README Q5: write the WHOLE namespace (all three fields are
            // required) from a fresh read, so another operator's loop/gap is
            // kept, then a plain reboot. The agent already switches on the
            // config change; the reboot is the visible offline -> online.
            let switched = false
            try {
              if (scenarioId && scenarioId !== currentScenarioId) {
                const fresh = await xg().devices.get(id)
                await xg().devices.patchConfig(id, {
                  simulation: buildSimulationConfig(fresh.config, scenarioId),
                })
                switched = true
                invalidateDevices(id)
              }
              await xg().devices.reboot(id)
              toast.success(
                switched
                  ? `Rebooting ${label} into the new scenario`
                  : `Reboot command sent to ${label}`
              )
              setRebootDialogOpen(false)
            } catch (err) {
              toast.error(
                switched
                  ? `Scenario switched (the device picks it up live), but the reboot was not sent: ${xgMessage(err)}`
                  : xgMessage(err)
              )
            }
          }}
        />
      ) : device ? (
        <RebootDeviceDialog
          open={rebootDialogOpen}
          onOpenChange={setRebootDialogOpen}
          deviceName={device.name ?? device.serial}
          onConfirm={async () => {
            try {
              await xg().devices.reboot(id)
              toast.success(
                `Reboot command sent to ${device.name ?? device.serial}`
              )
              setRebootDialogOpen(false)
            } catch (err) {
              toast.error(xgMessage(err))
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
              await xg().devices.powerOff(id)
              setPowerOnClicked(false)
              toast.success(
                `Power off command sent to ${device.name ?? device.serial}`
              )
              setPowerOffDialogOpen(false)
            } catch (err) {
              toast.error(xgMessage(err))
            }
          }}
        />
      ) : null}
    </div>
  )
}
