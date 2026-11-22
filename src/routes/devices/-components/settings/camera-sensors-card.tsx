import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  RotateCwIcon,
} from "lucide-react"
import type { Device } from "@xorgate/sdk"
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
  CAMERA_SENSORS_SAVE_KEY,
  cameraPortTruth,
  cameraSensorsCalloutRepeatsPorts,
  cameraSensorsGate,
  parseReportedCameras,
  storedCameraSensor,
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

const SENSOR_ID = (port: string) => `device-camera-sensor-${port}`

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
 *    that advertises `camera.sensors`, on a model that declares the port.
 *  - the truth, from `effective.cameras`: one state indicator per port from
 *    the device's verdict. A port with something to explain adds the device's
 *    own sentence verbatim and the facts to diagnose with; a healthy or
 *    deliberately empty one says it once (`cameraPortTruth`).
 *
 * The card says each thing once. It never writes a second explanation of its
 * own beside the device's, and the namespace's callout is left out when it
 * would only repeat a port.
 *
 * Who sees it: a simulator has no camera ports and a JS device has nothing to
 * choose and reports nothing here, so neither gets the card. A Rust agent
 * from before the feature gets the truth it reports and one line naming the
 * version needed.
 *
 * Every control saves under ONE pending key: the namespace is replaced whole
 * on write, so while a save is in flight the whole card is disabled and a
 * second save can never be built on a form the first is about to re-seed.
 */
export function CameraSensorsCard({
  device,
  ports,
  modelState,
  status,
  isPending,
  commitCameraSensors,
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
  commitCameraSensors: (
    change: CameraSensorChange,
    ports: readonly string[] | null
  ) => void
}) {
  const gate = cameraSensorsGate(device)
  const reported = parseReportedCameras(device.reportedConfig)
  const hasStored = Object.keys(storedCameraSensors(device.config)).length > 0
  const saving = isPending(CAMERA_SENSORS_SAVE_KEY)

  // Nothing to choose and nothing reported: a simulator has no camera ports,
  // and the JS agent neither acts on the setting nor reports the ports.
  if (!gate.allowed && gate.reason !== "agent-version") return null

  const canChoose = gate.allowed && ports !== null && ports.length > 0
  // The model is loaded and declares no camera port: every value is refused
  // there, and only a clear (`null`) is accepted.
  const noPorts =
    gate.allowed &&
    modelState === "ready" &&
    (ports === null || ports.length === 0)
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

  // A capable device with no cameras at all: no port, nothing reported,
  // nothing stored and nothing the device has said about the setting.
  if (noPorts && rows.length === 0 && !hasStored && status.state === "unset") {
    return null
  }

  const change = (next: CameraSensorChange) =>
    commitCameraSensors(next, ports?.map((p) => p.key) ?? null)

  return (
    <Card data-testid="camera-sensors-card">
      <CardHeader>
        <CardTitle>Camera sensors</CardTitle>
        <CardDescription>
          Which image sensor is attached to each camera port.
        </CardDescription>
        {/* Whenever the device may hold the namespace, whatever the model
            says: a refusal is never hidden behind a model without ports. */}
        {gate.allowed ? (
          <CardAction>
            <ConfigStatusBadge status={status} />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {gate.allowed && modelState === "loading" && rows.length === 0 ? (
            <Skeleton className="h-16 w-full" />
          ) : null}
          {rows.map((row, i) => (
            <div key={row.key} className="contents">
              {i > 0 ? <FieldSeparator /> : null}
              <PortRow
                port={row.key}
                connector={row.connector}
                camera={row.camera}
                entry={storedCameraSensor(device.config, row.key)}
                picker={canChoose && ports.some((p) => p.key === row.key)}
                agentVersion={device.agentVersion}
                disabled={saving}
                onChange={change}
              />
            </div>
          ))}
          {!gate.allowed ? (
            <SettingsCallout>
              <span data-testid="camera-sensors-gate">{gate.message}</span>
            </SettingsCallout>
          ) : modelState === "error" && ports === null ? (
            <SettingsCallout>
              <span data-testid="camera-sensors-gate">
                This device&rsquo;s model could not be loaded, so its camera
                ports are unknown.
              </span>
            </SettingsCallout>
          ) : noPorts && hasStored ? (
            // A value left behind, usually by a model reassignment. Nothing
            // can be chosen here, and the stored value cannot be edited
            // either: the one thing the API accepts is clearing it.
            <SettingsCallout>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span data-testid="camera-sensors-gate">
                  This device&rsquo;s model declares no camera ports, but a
                  camera sensor setting is still stored for it.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  data-testid="camera-sensors-clear"
                  onClick={() => change({ clear: true })}
                >
                  Clear the setting
                </Button>
              </div>
            </SettingsCallout>
          ) : noPorts ? (
            <SettingsCallout>
              <span data-testid="camera-sensors-gate">
                This device&rsquo;s model declares no camera ports, so a sensor
                cannot be chosen per port.
              </span>
            </SettingsCallout>
          ) : null}
          {/* The device's sentence about the SETTING (`detail` when adjusted,
              `reason` when rejected, verbatim), unless a port already says it.
              A refusal can name several ports and quote paths and whole
              config.txt lines: it wraps inside the card, never widens it. */}
          {gate.allowed &&
          !cameraSensorsCalloutRepeatsPorts(status, reported) ? (
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
  disabled,
  onChange,
}: {
  port: string
  connector: string | null
  camera: ReportedCamera | null
  /** The stored declaration for this port; undefined = not managed. */
  entry: CameraSensorEntry | undefined
  picker: boolean
  agentVersion: string | null
  /** A save of this card is in flight. */
  disabled: boolean
  onChange: (change: CameraSensorChange) => void
}) {
  const selectId = SENSOR_ID(port)
  // "Declared" would repeat the select of a managed port.
  const truth = cameraPortTruth(camera, picker && entry !== undefined)
  const tone = truth.verdict ? TONE[truth.verdict.tone] : null
  const sensor = entry ? cameraSensor(entry.sensor) : undefined
  const value = entry === undefined ? UNMANAGED : entry.sensor
  // A stored id this console cannot offer (a newer backend catalog, or a
  // sensor that is only planned) still has to be IN the select, or the control
  // would show nothing. It is the only way such an id ever appears there:
  // sensors that cannot be chosen are not listed.
  const notOffered =
    entry !== undefined &&
    entry.sensor !== CAMERA_SENSOR_NONE &&
    sensor === undefined
  const whyNotOffered = notOffered
    ? CAMERA_CATALOG.unavailable.find((s) => s.id === entry.sensor)?.why
    : undefined

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
        {truth.verdict && tone ? (
          <span className="flex min-w-0 shrink-0 items-center gap-2">
            {/* What was found on a port the device calls `ok`, beside whether
                it works: a camera that is off or still starting is detected,
                not working (`cameraPortTruth`). */}
            {truth.detected ? (
              <span
                className="truncate font-mono text-muted-foreground"
                data-testid={`camera-detected-${port}`}
              >
                {truth.detected}
              </span>
            ) : null}
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
              {truth.verdict.label}
            </span>
          </span>
        ) : null}
      </div>

      {picker ? (
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <Field>
            <Select
              value={value}
              disabled={disabled}
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
                    description={
                      whyNotOffered === "planned"
                        ? "not supported yet"
                        : whyNotOffered === "newer"
                          ? "needs a newer console"
                          : "not known to this console"
                    }
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
          </Field>
          {sensor && entry
            ? sensor.options.map((option) => (
                <OptionField
                  key={option.key}
                  port={port}
                  option={option}
                  stored={entry.options?.[option.key]}
                  disabled={disabled}
                  onChange={onChange}
                />
              ))
            : null}
        </div>
      ) : null}

      {/* The device's own sentence, verbatim: only for a port with something
          to explain. The indicator above carries the colour; the sentence
          steps up from muted when the port needs the operator. It can quote a
          whole config.txt line or a path, so it wraps anywhere. */}
      {truth.sentence ? (
        <p
          className={cn(
            "[overflow-wrap:anywhere]",
            truth.verdict?.tone === "problem" ||
              truth.verdict?.tone === "action"
              ? "text-foreground"
              : "text-muted-foreground"
          )}
          data-testid={`camera-detail-${port}`}
        >
          {truth.sentence}
        </p>
      ) : null}
      {truth.facts.length > 0 ? (
        <dl
          className="grid max-w-2xl grid-cols-3 gap-x-6"
          data-testid={`camera-facts-${port}`}
        >
          {truth.facts.map((fact) => (
            <InfoRow
              key={fact.label}
              label={fact.label}
              value={fact.value}
              title={fact.value}
            />
          ))}
        </dl>
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
  disabled,
  onChange,
}: {
  port: string
  option: CameraSensorOption
  /** The value the setting names; undefined = not named (as found). */
  stored: number | undefined
  disabled: boolean
  onChange: (change: CameraSensorChange) => void
}) {
  const id = `${SENSOR_ID(port)}-${option.key}`
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
        disabled={disabled}
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
