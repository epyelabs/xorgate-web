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
import { DownloadIcon, RefreshCwIcon } from "lucide-react"
import { xg, xgMessage } from "@/lib/xorgate"
import { useInvalidateDevices } from "@/queries/devices"
import type {
  AgentBuild as LatestAgentBuild,
  Device,
  DeviceIdentity,
} from "@xorgate/sdk"
import {
  reportedAgentBuild,
  reportedAgentMode,
  type ReportedAgentBuild,
} from "@/lib/device-config-status"
import { updateDeviceSchema } from "@/lib/schemas"
import { useHasPermission } from "@/lib/permissions"
import { DeleteDeviceDialog } from "../delete-device-dialog"
import { InfoRow } from "../info-row"
import { OwnershipCard } from "./ownership-card"
import { UpdateDeviceDialog } from "../update-device-dialog"
import { formatTimestamp } from "./shared"

/** Built date + channel + package version — the detail the row has no room for. */
function buildTooltip(build: ReportedAgentBuild | null): string | undefined {
  if (build === null) return undefined
  const parts = [`Build ${build.version}`]
  if (build.channel) parts.push(`channel ${build.channel}`)
  if (build.packageVersion) parts.push(`agent ${build.packageVersion}`)
  if (build.builtAt) parts.push(`built ${formatTimestamp(build.builtAt)}`)
  return parts.join(" · ")
}

const NAME_KEY = "device-name"
const MAX_NAME_LENGTH = 80

export function GeneralTab({
  device,
  identity,
  identityLoaded,
  isPending,
  commit,
  updateAgent,
  updatingAgent,
}: {
  device: Device
  identity: DeviceIdentity | null
  identityLoaded: boolean
  isPending: (key: string) => boolean
  commit: (key: string, patch: { name?: string | null }) => void
  /**
   * Ask the device to install the latest published agent build. The version
   * we expect afterwards (when known) lets the hook tell a deliberate
   * reinstall apart from an update that silently rolled back.
   */
  updateAgent: (expectedVersion?: string | null) => void
  updatingAgent: boolean
}) {
  const navigate = useNavigate()
  const invalidateDevices = useInvalidateDevices()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const canTransfer = useHasPermission("devices:transfer")
  const [updateOpen, setUpdateOpen] = useState(false)
  const agentMode = reportedAgentMode(device)

  const installedBuild = reportedAgentBuild(device)
  // A hand-deployed tree is honest about being one; worth surfacing, because
  // "why doesn't this match the sha CI published" has exactly this answer.
  const localBuild =
    installedBuild?.channel === "local" || installedBuild?.channel === "bench"

  // What a device update would install. Fetched once per mount; a stage with no
  // published manifest (404 -> null) simply shows no "update available" dot —
  // the action stays available, since a reinstall is always valid.
  const [latestBuild, setLatestBuild] = useState<LatestAgentBuild | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const latest = await xg().devices.latestAgentBuild()
        if (!cancelled) setLatestBuild(latest)
      } catch {
        // Leave it unknown — this is decoration, not the action itself.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // String equality only: shas have no order, and a dev sha and a prod release
  // tag are not comparable at all.
  const installedVersion = installedBuild?.version ?? device.agentVersion ?? null
  const updateAvailable =
    latestBuild !== null &&
    installedVersion !== null &&
    latestBuild.version !== installedVersion

  const canUpdate = device.status === "online" && !updatingAgent
  const updateHint = updatingAgent
    ? "Update in progress…"
    : device.status !== "online"
      ? "The device must be online to be updated"
      : updateAvailable
        ? `Update available: ${latestBuild?.version}`
        : "Install the latest agent build"

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
        const model = await xg().deviceModels.get(device.deviceModelId)
        if (!cancelled) setModelName(model.name)
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
      await xg().devices.delete(device.id)
    } catch (err) {
      toast.error(xgMessage(err))
      return
    }
    // The fleet list is cached; without this the deleted device stays in it
    // until the next poll, and its own keys would refetch a 404.
    invalidateDevices(device.id)
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
              {/* The build the agent reports running, with the mirrored column
                  as the fallback for a device whose report we don't hold.
                  Read-only like the rest of this card — the only write is the
                  update action beside it, which asks the DEVICE to change it
                  rather than writing a value here. */}
              <InfoRow
                label="Agent version"
                value={
                  <>
                    {installedBuild?.version ?? device.agentVersion ?? "—"}
                    {localBuild && (
                      <span className="text-muted-foreground font-sans">
                        {" "}
                        ({installedBuild?.channel})
                      </span>
                    )}
                  </>
                }
                title={buildTooltip(installedBuild)}
                mono
                action={
                  <span title={updateHint}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={undefined}
                      aria-label="Update device agent"
                      disabled={!canUpdate}
                      onClick={() => setUpdateOpen(true)}
                    >
                      {/* Download at rest (the action is "install this build"),
                          but a spinning download arrow reads as nonsense — so
                          the in-flight state switches to the refresh glyph,
                          which is what spins everywhere else in the app (see
                          the SIM card's refresh). */}
                      {updatingAgent ? (
                        <RefreshCwIcon className="animate-spin" />
                      ) : (
                        <DownloadIcon />
                      )}
                    </Button>
                    {updateAvailable && (
                      <span
                        aria-label="Update available"
                        title={`Update available: ${latestBuild?.version}`}
                        className="bg-primary inline-block size-1.5 rounded-full align-top"
                      />
                    )}
                  </span>
                }
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

      {/* Above the Danger zone, not inside it: a same-organization transfer is
          reversible in one click, which is not the company Delete keeps. */}
      {canTransfer ? <OwnershipCard device={device} /> : null}

      {/* Action in the header rather than a content row of its own: one button
          under a two-line header leaves a card of mostly padding. */}
      <Card className="ring-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Permanently delete this device: its recordings, telemetry history,
            live-video channels and cloud identity. The agent, if still running,
            must be re-enrolled with a new claim code.
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

      {/* Fire-and-forget like reboot: the dialog closes as soon as the command
          reaches the broker. The hook then polls the device row for a changed
          reported build and toasts the outcome — success, came-back-unchanged,
          or timed out. */}
      <UpdateDeviceDialog
        open={updateOpen}
        onOpenChange={setUpdateOpen}
        deviceName={device.name ?? device.serial}
        installed={installedBuild}
        latest={latestBuild}
        onConfirm={() => {
          updateAgent(latestBuild?.version ?? null)
          setUpdateOpen(false)
        }}
      />
    </div>
  )
}
