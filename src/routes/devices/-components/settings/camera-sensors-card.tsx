import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  RotateCwIcon,
} from "lucide-react"
import type { Device } from "@xorgate/sdk"
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
  FieldSeparator,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import type { DeviceSettingsPatch } from "@/hooks/use-device-settings"
import {
  CAMERA_CATALOG,
  CAMERA_SENSOR_NONE,
  agentPredatesSensor,
  cameraSensor,
  cameraSensorHints,
  cameraSensorLabel,
  formatCameraOptionValue,
  type CameraSensorOption,
} from "@/lib/camera-catalog"
import {
  VERDICT_REBOOT_REQUIRED,
  buildCameraSensorsConfig,
  cameraSensorsCalloutRepeatsPorts,
  cameraSensorsGate,
  cameraVerdict,
  parseReportedCameras,
  reportedCameraFacts,
  storedCameraSensors,
  type CameraPort,
  type CameraSensorChange,
  type CameraSensorEntry,
  type CameraVerdictTone,
  type ReportedCamera,
} from "@/lib/device-cameras"
import type { NamespaceStatus } from "@/lib/device-config-status"
import { cn } from "@/lib/utils"
import { InfoRow } from "../info-row"
import { SettingsCallout } from "./callout"
import { ConfigStatusBadge, ConfigStatusCallout } from "./config-status"

const SENSOR_KEY = (port: string) => `device-camera-sensor-${port}`

/**
 * Select value for "this port is not managed" (the key is absent). Not a
 * sensor id and cannot collide with one: ids are lower-case alphanumerics.
 */
const UNMANAGED = "~unmanaged"

/**
 * Same restraint as the SIM card and `ConfigStatusBadge`: a healthy port gets
 * muted text and a coloured icon; colour on the words is kept for the states
 * an operator has to act on.
 */
const TONE: Record<
  CameraVerdictTone,
  { text?: string; icon: React.ReactNode }
> = {
  ok: {
    icon: (
      <CheckCircleIcon className="text-emerald-600 dark:text-emerald-400" />
    ),
  },
  action: {
    text: "text-amber-700 dark:text-amber-400",
    icon: <RotateCwIcon />,
  },
  problem: { text: "text-destructive", icon: <AlertTriangleIcon /> },
  neutral: { text: "text-muted-foreground", icon: <CircleDashedIcon /> },
}

/**
 * Settings > Media > Camera sensors (plans/support-other-camera-models,
 * Phase 3): which image sensor is on each camera port, beside what the device
 * found there.
 *
 * Two halves per port, like the OBD and APN cards:
 *
 *  - the choice, written to the `cameraSensors` namespace. Offered only where
 *    the API accepts it (`cameraSensorsGate`): a real device on a Rust agent
 *    that advertises `camera.sensors`. Everywhere else there is no picker, and
 *    one line says which agent is needed.
 *  - the truth, from `effective.cameras`: one state indicator per port derived
 *    from the device's verdict, three facts, and the device's own sentence
 *    verbatim. The console never writes a second explanation of its own.
 *
 * A change takes effect at the device's next boot. The device says so itself
 * (verdict `reboot-required`), and the card points at Reboot Device.
 */
export function CameraSensorsCard({
  device,
  ports,
  modelState,
  status,
  isPending,
  commit,
}: {
  device: Device
  /**
   * The camera ports of the device's model, or null when they are unknown (a
   * model without a hardware block, or one that is not loaded): the API
   * refuses the namespace for a model that declares none.
   */
  ports: CameraPort[] | null
  /** Where the model query stands; `ports` means something only when `ready`. */
  modelState: "loading" | "ready" | "error"
  status: NamespaceStatus
  isPending: (key: string) => boolean
  commit: (key: string, patch: DeviceSettingsPatch) => void
}) {
  const gate = cameraSensorsGate(device)
  const modelLoading = modelState === "loading"
  const reported = parseReportedCameras(device.reportedConfig)
  const stored = storedCameraSensors(device.config)

  // A simulator has no camera ports and reports no camera block: nothing to
  // choose and nothing to show.
  if (!gate.allowed && gate.reason === "simulated") return null

  const canChoose = gate.allowed && ports !== null && ports.length > 0
  // Model ports first, in model order, then any port only the device reports.
  const rows: {
    key: string
    connector: string | null
    camera: ReportedCamera | null
  }[] = []
  for (const port of canChoose ? ports : []) {
    rows.push({
      key: port.key,
      connector: port.connector,
      camera: reported.find((c) => c.port === port.key) ?? null,
    })
  }
  for (const camera of reported) {
    if (rows.some((r) => r.key === camera.port)) continue
    rows.push({ key: camera.port, connector: camera.connector, camera })
  }

  // A qualifying device on a model with no cameras at all, and nothing reported.
  if (gate.allowed && !modelLoading && ports !== null && rows.length === 0)
    return null

  function change(next: CameraSensorChange) {
    commit(SENSOR_KEY(next.port), {
      cameraSensorsConfig: buildCameraSensorsConfig(device.config, next, {
        ports: ports?.map((p) => p.key) ?? null,
      }),
    })
  }

  // The namespace's own callout is the device's sentence about the SETTING
  // (`detail` when adjusted, `reason` when rejected, verbatim). It is left out
  // in the one case where it would only repeat the ports: written, waiting
  // for a reboot, and every port that waits says so itself.
  const showRailCallout =
    canChoose && !cameraSensorsCalloutRepeatsPorts(status, reported)

  return (
    <Card data-testid="camera-sensors-card">
      <CardHeader>
        <CardTitle>Camera sensors</CardTitle>
        <CardDescription>
          Which image sensor is attached to each camera port. A change is
          written to the device&rsquo;s boot configuration and takes effect the
          next time it boots.
        </CardDescription>
        {canChoose ? (
          <CardAction>
            <ConfigStatusBadge status={status} />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {gate.allowed && modelLoading && rows.length === 0 ? (
            <Skeleton className="h-16 w-full" />
          ) : null}
          {rows.map((row, i) => (
            <div key={row.key} className="contents">
              {i > 0 ? <FieldSeparator /> : null}
              <PortRow
                port={row.key}
                connector={row.connector}
                camera={row.camera}
                entry={stored[row.key]}
                picker={canChoose && ports.some((p) => p.key === row.key)}
                agentVersion={device.agentVersion}
                pending={isPending(SENSOR_KEY(row.key))}
                onChange={change}
              />
            </div>
          ))}
          {!gate.allowed ? (
            <SettingsCallout>
              <span data-testid="camera-sensors-gate">{gate.message}</span>
            </SettingsCallout>
          ) : !modelLoading && ports === null ? (
            <SettingsCallout>
              <span data-testid="camera-sensors-gate">
                {modelState === "error"
                  ? "This device's model could not be loaded, so its camera ports are unknown."
                  : "This device's model declares no camera ports, so a sensor cannot be chosen per port."}
              </span>
            </SettingsCallout>
          ) : null}
          {/* A refusal can name several ports and quote paths and whole
              config.txt lines: it must wrap inside the card, never widen it. */}
          {showRailCallout ? (
            <ConfigStatusCallout
              status={status}
              className="[overflow-wrap:anywhere]"
            />
          ) : null}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

function PortRow({
  port,
  connector,
  camera,
  entry,
  picker,
  agentVersion,
  pending,
  onChange,
}: {
  port: string
  connector: string | null
  camera: ReportedCamera | null
  /** The stored declaration for this port; undefined = not managed. */
  entry: CameraSensorEntry | undefined
  picker: boolean
  agentVersion: string | null
  pending: boolean
  onChange: (change: CameraSensorChange) => void
}) {
  const selectId = SENSOR_KEY(port)
  const verdict = cameraVerdict(camera?.verdict ?? null)
  const tone = verdict ? TONE[verdict.tone] : null
  // A block with none of the three facts in it (an agent that sent only a
  // verdict, or a shape this build cannot read) gets no row of dashes.
  const facts =
    camera && (camera.declared?.sensor || camera.detected || camera.capture)
      ? reportedCameraFacts(camera)
      : null
  const sensor = entry ? cameraSensor(entry.sensor) : undefined
  const hints = sensor ? cameraSensorHints(sensor) : []
  const value = entry === undefined ? UNMANAGED : entry.sensor
  // A stored id this console cannot offer (a newer backend catalog, or a
  // sensor that is only planned) still has to be IN the select, or the control
  // would show nothing. It is the only way such an id ever appears there:
  // sensors that cannot be chosen are not listed.
  const notOffered =
    entry !== undefined &&
    entry.sensor !== CAMERA_SENSOR_NONE &&
    sensor === undefined

  return (
    <div className="flex flex-col gap-2" data-testid={`camera-port-${port}`}>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel htmlFor={picker ? selectId : undefined}>
          Camera <span className="font-mono">{port}</span>
          {connector ? (
            <span className="font-normal text-muted-foreground">
              {connector}
            </span>
          ) : null}
        </FieldLabel>
        {verdict && tone ? (
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 font-medium",
              tone.text,
              "[&_svg]:size-3.5 [&_svg]:shrink-0"
            )}
            data-testid={`camera-verdict-${port}`}
            data-verdict={camera?.verdict ?? ""}
          >
            {tone.icon}
            {verdict.label}
          </span>
        ) : null}
      </div>

      {picker ? (
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <Field>
            <Select
              value={value}
              disabled={pending}
              onValueChange={(next) =>
                onChange(
                  next === UNMANAGED
                    ? { port, unmanaged: true }
                    : { port, sensor: next }
                )
              }
            >
              <SelectTrigger id={selectId} aria-label={`Sensor on ${port}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAMERA_CATALOG.sensors.map((s) => {
                  const tooOld = agentPredatesSensor(s, agentVersion)
                  const itemHints = tooOld
                    ? [`needs agent ${s.minAgent}`]
                    : cameraSensorHints(s)
                  return (
                    <SelectItem
                      key={s.id}
                      value={s.id}
                      // The stored value stays selectable-looking: it is what
                      // the device was told, whatever this console thinks.
                      disabled={tooOld && s.id !== value}
                      description={
                        itemHints.length > 0 ? itemHints.join(" · ") : undefined
                      }
                    >
                      {s.label}
                    </SelectItem>
                  )
                })}
                {notOffered ? (
                  <SelectItem
                    value={entry.sensor}
                    description="not known to this console"
                  >
                    {cameraSensorLabel(entry.sensor)}
                  </SelectItem>
                ) : null}
                <SelectItem
                  value={CAMERA_SENSOR_NONE}
                  description="the port is empty"
                >
                  No camera
                </SelectItem>
                <SelectItem
                  value={UNMANAGED}
                  description="leave the device's boot configuration as it is"
                >
                  Not managed
                </SelectItem>
              </SelectContent>
            </Select>
            {hints.length > 0 ? (
              <FieldDescription data-testid={`camera-sensor-hint-${port}`}>
                This sensor {hints.join(" and ")}.
              </FieldDescription>
            ) : null}
          </Field>
          {sensor && entry
            ? sensor.options.map((option) => (
                <OptionField
                  key={option.key}
                  port={port}
                  option={option}
                  stored={entry.options?.[option.key]}
                  pending={pending}
                  onChange={onChange}
                />
              ))
            : null}
        </div>
      ) : null}

      {facts ? (
        <dl
          className="grid max-w-2xl grid-cols-3 gap-x-6"
          data-testid={`camera-facts-${port}`}
        >
          <InfoRow
            label="Declared"
            value={facts.declared}
            title={facts.declared}
          />
          <InfoRow
            label="Detected"
            value={facts.detected}
            title={facts.detected}
          />
          <InfoRow label="Frames" value={facts.frames} />
        </dl>
      ) : null}
      {/* The device's own sentence, verbatim. The indicator above carries the
          colour; the sentence only steps up from muted when the port needs
          the operator. */}
      {camera?.detail ? (
        <p
          className={cn(
            // The sentence can quote a whole config.txt line or a path.
            "[overflow-wrap:anywhere]",
            verdict?.tone === "problem" || verdict?.tone === "action"
              ? "text-foreground"
              : "text-muted-foreground"
          )}
          data-testid={`camera-detail-${port}`}
        >
          {camera.detail}
        </p>
      ) : null}
      {camera?.verdict === VERDICT_REBOOT_REQUIRED ? (
        <p
          className="text-muted-foreground"
          data-testid={`camera-reboot-${port}`}
        >
          Use Reboot Device at the top of this page to apply it.
        </p>
      ) : null}
    </div>
  )
}

/**
 * Select value for "this option is not named by the setting". Not a number,
 * so it cannot collide with an option value.
 */
const AS_FOUND = "~as-found"

/**
 * One per-board parameter of the declared sensor, compact.
 *
 * An option the setting does not name is left as the device's own config.txt
 * line has it: the agent does not reset it to the overlay default. So the
 * first choice is "As found on the device", which is what an entry without the
 * key means, and it is what the select shows then; the catalog default is
 * never shown as if it were set. Picking a value names it (the default
 * included: that is a declaration too); picking "As found" removes the key.
 */
function OptionField({
  port,
  option,
  stored,
  pending,
  onChange,
}: {
  port: string
  option: CameraSensorOption
  /** The value the setting names; undefined = not named (as found). */
  stored: number | undefined
  pending: boolean
  onChange: (change: CameraSensorChange) => void
}) {
  const id = `${SENSOR_KEY(port)}-${option.key}`
  const named = typeof stored === "number"
  // A named value the catalog does not list (a newer catalog) is shown as it
  // is and never rewritten unless the operator picks another.
  const values =
    !named || option.values.includes(stored)
      ? option.values
      : [...option.values, stored]
  return (
    <Field orientation="horizontal" className="items-center">
      <FieldLabel
        htmlFor={id}
        className="shrink-0 font-normal whitespace-nowrap text-muted-foreground"
        title={option.description || undefined}
      >
        {option.label}
      </FieldLabel>
      <Select
        value={named ? String(stored) : AS_FOUND}
        disabled={pending}
        onValueChange={(next) =>
          onChange({
            port,
            option: option.key,
            value: next === AS_FOUND ? null : Number(next),
          })
        }
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AS_FOUND}>As found on the device</SelectItem>
          {values.map((v) => (
            <SelectItem key={v} value={String(v)}>
              {formatCameraOptionValue(option, v)}
              {v === option.default ? " (default)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
