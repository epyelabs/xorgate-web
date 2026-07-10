import { useEffect, useState } from "react"
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router"
import { toast } from "sonner"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ApiError,
  getDevice,
  getDeviceModel,
  type Device,
  type DeviceModel,
  type DeviceStatus,
} from "@/lib/api"
import { DeviceModelDialog } from "./-components/device-model-dialog"
import { RebootDeviceDialog } from "./-components/reboot-device-dialog"
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

function deviceInitials(device: Device): string {
  const source = device.name ?? device.serial
  return source.slice(0, 2).toUpperCase()
}

const TAB_VALUES = [
  "overview",
  "streams",
  "telemetry",
  "media",
  "workflows",
  "benchmark",
  "settings",
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
              <Avatar size="lg">
                <AvatarFallback>
                  {device ? deviceInitials(device) : "—"}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-3">
                  <h1 className="text-md font-semibold tracking-tight">
                    {device?.name ?? device?.serial ?? "Device"}
                  </h1>
                  {device ? (
                    <Badge variant={statusVariant(device.status)}>
                      {device.status}
                    </Badge>
                  ) : null}
                </div>
                {device ? (
                  <p className="text-xs text-muted-foreground">
                    {deviceModel ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setModelDialogOpen(true)}
                          className="underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
                        >
                          {deviceModel.name}
                        </button>
                        {" · "}
                      </>
                    ) : null}
                    Last seen {formatRelative(device.lastSeenAt)}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">{id}</p>
                )}
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              disabled={!device}
              onClick={() => setRebootDialogOpen(true)}
              className="self-start"
            >
              Reboot Device
            </Button>
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

        <div className="border-b border-border">
          <Tabs value={activeTab}>
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

      {device ? (
        <RebootDeviceDialog
          open={rebootDialogOpen}
          onOpenChange={setRebootDialogOpen}
          deviceName={device.name ?? device.serial}
          onConfirm={async () => {
            // Dummy reboot: no device command is issued yet. Simulate the
            // round-trip so the button shows its pending state, then confirm.
            await new Promise((resolve) => setTimeout(resolve, 600))
            toast.success(
              `Reboot command sent to ${device.name ?? device.serial}`
            )
            setRebootDialogOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}
