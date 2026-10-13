import { useState } from "react"
import { toast } from "sonner"
import { BluetoothSearchingIcon, LoaderIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Switch } from "@/components/ui/switch"
import { isXorgateError, type Device, type ObdPeripheralCapability } from "@xorgate/sdk"
import type { DeviceSettingsPatch } from "@/hooks/use-device-settings"
import type { DeviceConfigStatus } from "@/lib/device-config-status"
import {
  OBD_POLL_HZ_OPTIONS,
  buildObdConfig,
  forgetObdConfig,
  isScanAfter,
  macInputError,
  normalizeMac,
  obdScanBlocker,
  pinInputError,
  reportedObd,
  resolveObd,
  selectedObdFields,
  type ObdFieldName,
  type ObdPowerSource,
  type ResolvedObd,
} from "@/lib/device-obd"
import { useCurrentRole } from "@/lib/permissions"
import { metricLabel } from "@/lib/telemetry-meta"
import { cn } from "@/lib/utils"
import { xg, xgMessage } from "@/lib/xorgate"
import { ConfigStatusBadge, ConfigStatusCallout } from "./config-status"
import { formatTimestamp, withCurrent } from "./shared"

const ENABLED_KEY = "device-obd-enabled"
const ADAPTER_KEY = "device-obd-adapter"
const PIN_KEY = "device-obd-pin"
const POLL_KEY = "device-obd-poll-hz"
const FIELDS_KEY = "device-obd-fields"
const POWER_KEY = "device-obd-power-source"
const FORGET_KEY = "device-obd-forget"

/** 12 x 5 s: discovery runs ~10 to 20 s and the report follows within seconds. */
const SCAN_POLL_TICKS = 12

const POWER_SOURCE_OPTIONS: { value: ObdPowerSource; label: string }[] = [
  { value: "switched", label: "Switched 12 V socket (default)" },
  { value: "constant", label: "Hardwired, always on" },
]

/**
 * The `obd` namespace (plan section 9 stages 3, 6 and 9): which adapter the
 * device pairs with and how it polls. Every control writes the namespace
 * WHOLE through `commit` like its siblings; the two device commands (scan,
 * forget) go straight to the SDK because they are not config.
 *
 * Setup is the only place pairing happens (plan decision D3): the device
 * never pairs by name, so the adapter is always an explicit MAC, either
 * picked from a scan or typed from the dongle's label.
 */
export function ObdCard({
  device,
  capability,
  configStatus,
  isPending,
  commit,
  pollReport,
}: {
  device: Device
  capability: ObdPeripheralCapability
  configStatus: DeviceConfigStatus
  isPending: (key: string) => boolean
  commit: (key: string, patch: DeviceSettingsPatch) => void
  pollReport: (done: (device: Device) => boolean, maxTicks?: number) => Promise<boolean>
}) {
  const resolved = resolveObd(device.config.obd ?? null)
  const declared = capability.fields
  const role = useCurrentRole()
  // Forget drops a Bluetooth bond on the device: owner/admin/member on the
  // API; a viewer's click would only bounce as a 403.
  const canForget = role !== "viewer"

  function save(key: string, patch: Partial<ResolvedObd>) {
    commit(key, { obdConfig: buildObdConfig({ ...resolved, ...patch }) })
  }

  // Text inputs are drafts so partial typing never fights the stored value;
  // re-seeded from the device when the stored value moves (a save landing, or
  // a failed save rolling back). Adjusted during render rather than in an
  // effect, per React's "adjusting state when a prop changes" idiom.
  const [macDraft, setMacDraft] = useState(resolved.adapterMac ?? "")
  const [macSeed, setMacSeed] = useState(resolved.adapterMac)
  if (macSeed !== resolved.adapterMac) {
    setMacSeed(resolved.adapterMac)
    setMacDraft(resolved.adapterMac ?? "")
  }
  const [pinDraft, setPinDraft] = useState(resolved.pin)
  const [pinSeed, setPinSeed] = useState(resolved.pin)
  if (pinSeed !== resolved.pin) {
    setPinSeed(resolved.pin)
    setPinDraft(resolved.pin)
  }

  const macError = macInputError(macDraft)
  const macDirty = (normalizeMac(macDraft) || null) !== resolved.adapterMac
  function saveMac() {
    if (macError !== null) return
    const next = normalizeMac(macDraft) || null
    setMacDraft(next ?? "")
    save(ADAPTER_KEY, { adapterMac: next })
  }

  const pinError = pinInputError(pinDraft)
  function savePin() {
    if (pinError !== null) {
      setPinDraft(resolved.pin)
      return
    }
    // A blur with nothing typed must never write: the stored namespace may be
    // partial, so the hook's own equality check would see the resolved whole
    // as a change.
    if (pinDraft === resolved.pin) return
    save(PIN_KEY, { pin: pinDraft })
  }

  // Field checkboxes are a draft with an explicit Apply: each tick would
  // otherwise be its own save and its own helper restart on the device.
  const stored = selectedObdFields(resolved.fields, declared)
  const storedKey = stored.join(",")
  const [fieldsDraft, setFieldsDraft] = useState<ObdFieldName[]>(stored)
  const [fieldsSeed, setFieldsSeed] = useState(storedKey)
  if (fieldsSeed !== storedKey) {
    setFieldsSeed(storedKey)
    setFieldsDraft(stored)
  }
  const fieldsDirty = fieldsDraft.join(",") !== storedKey
  function toggleField(field: ObdFieldName, on: boolean) {
    setFieldsDraft((prev) =>
      declared.filter((f) => (f === field ? on : prev.includes(f)))
    )
  }

  // Scan: a command whose answer lands on the config report, so after the
  // ack the card watches the row until a scan newer than the one it saw.
  const reported = reportedObd(device)
  const scan = reported?.scan ?? null
  const [scanning, setScanning] = useState(false)
  const scanBlocker = obdScanBlocker(device)
  async function runScan() {
    const previousTs = scan?.ts ?? null
    const requestedAt = Date.now()
    setScanning(true)
    try {
      await xg().devices.obdScan(device.id)
      const found = await pollReport(
        (d) => isScanAfter(reportedObd(d)?.scan ?? null, requestedAt, previousTs),
        SCAN_POLL_TICKS
      )
      if (!found) {
        toast.info("The device accepted the scan but has not reported candidates yet — refresh in a minute.")
      }
    } catch (err) {
      const retryMs =
        isXorgateError(err) && err.code === "RATE_LIMITED"
          ? (err.details?.retryAfterMs as number | undefined)
          : undefined
      toast.error(
        retryMs !== undefined
          ? `Another scan is allowed in ${Math.ceil(retryMs / 1000)} s.`
          : xgMessage(err)
      )
    } finally {
      setScanning(false)
    }
  }

  const [forgetOpen, setForgetOpen] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  async function runForget() {
    setForgetting(true)
    try {
      await xg().devices.obdForget(device.id)
      // The command only drops the bond; the retained config would re-pair
      // the same adapter on the next settings poll unless it is cleared too.
      commit(FORGET_KEY, { obdConfig: forgetObdConfig(resolved) })
      toast.success("Adapter forgotten")
      setForgetOpen(false)
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setForgetting(false)
    }
  }

  const offline = device.status !== "online"
  const anyPending = [ENABLED_KEY, ADAPTER_KEY, PIN_KEY, POLL_KEY, FIELDS_KEY, POWER_KEY, FORGET_KEY].some(isPending)

  return (
    <Card data-testid="obd-card">
      <CardHeader>
        <CardTitle>Vehicle OBD-II</CardTitle>
        <CardDescription>
          The ELM327 adapter on the vehicle's diagnostic port and how the device polls it.
        </CardDescription>
        <CardAction>
          <ConfigStatusBadge status={configStatus.obd} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor={ENABLED_KEY}>Poll the vehicle</FieldLabel>
              <FieldDescription>
                Off by default. The kill switch for all OBD traffic: on, the device pairs with
                the adapter below and reads the vehicle; off, it stops and reports no vehicle data.
              </FieldDescription>
            </FieldContent>
            <Switch
              id={ENABLED_KEY}
              checked={resolved.enabled}
              disabled={isPending(ENABLED_KEY)}
              onCheckedChange={(next) => save(ENABLED_KEY, { enabled: next })}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={ADAPTER_KEY}>Adapter address</FieldLabel>
            <div className="flex max-w-md items-center gap-2">
              <Input
                id={ADAPTER_KEY}
                value={macDraft}
                placeholder="10:21:3E:4F:33:65"
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                disabled={isPending(ADAPTER_KEY)}
                aria-invalid={macError !== null}
                onChange={(e) => setMacDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && macDirty && macError === null) saveMac()
                }}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={isPending(ADAPTER_KEY) || !macDirty || macError !== null}
                onClick={saveMac}
              >
                Save
              </Button>
              <Button
                variant="outline"
                size="sm"
                title={scanBlocker ?? "Ask the device to look for nearby adapters"}
                disabled={scanning || scanBlocker !== null}
                onClick={runScan}
                data-testid="obd-scan"
              >
                {scanning ? <LoaderIcon className="animate-spin" /> : <BluetoothSearchingIcon />}
                {scanning ? "Scanning…" : "Scan"}
              </Button>
            </div>
            {macError !== null && <p className="text-destructive">{macError}</p>}
            <FieldDescription>
              The Bluetooth address printed on the adapter, or picked from a scan. The device
              pairs with this address only, never by name. Leave it empty for no adapter.
            </FieldDescription>
            {scan !== null && (
              <div className="flex flex-col gap-1" data-testid="obd-scan-candidates">
                <p className="text-muted-foreground">
                  Scan {formatTimestamp(new Date(scan.ts).toISOString())}:{" "}
                  {scan.error !== null
                    ? `failed (${scan.error})`
                    : scan.candidates.length === 0
                      ? "no adapters in range"
                      : `${scan.candidates.length} adapter${scan.candidates.length === 1 ? "" : "s"} in range`}
                </p>
                {scan.candidates.map((c) => (
                  <div
                    key={c.mac}
                    className="flex max-w-md items-center justify-between gap-3 rounded-md border border-border px-3 py-1.5"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{c.name ?? "Unnamed adapter"}</span>
                      <span className="font-mono text-muted-foreground">
                        {c.mac}
                        {c.rssi !== null ? ` · ${c.rssi} dBm` : ""}
                      </span>
                    </span>
                    <Button
                      variant={c.mac === resolved.adapterMac ? "secondary" : "outline"}
                      size="sm"
                      disabled={isPending(ADAPTER_KEY) || c.mac === resolved.adapterMac}
                      onClick={() => {
                        setMacDraft(c.mac)
                        save(ADAPTER_KEY, { adapterMac: c.mac })
                      }}
                    >
                      {c.mac === resolved.adapterMac ? "In use" : "Use"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor={PIN_KEY}>Pairing PIN</FieldLabel>
            <Input
              id={PIN_KEY}
              value={pinDraft}
              inputMode="numeric"
              autoComplete="off"
              className="max-w-32 font-mono"
              disabled={isPending(PIN_KEY)}
              aria-invalid={pinError !== null}
              onChange={(e) => setPinDraft(e.target.value.trim())}
              onBlur={savePin}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur()
              }}
            />
            {pinError !== null && <p className="text-destructive">{pinError}</p>}
            <FieldDescription>
              4 to 6 digits, for adapters that use legacy pairing (most ELM327 clones: 1234).
              Ignored by adapters that pair without one.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={POLL_KEY}>Poll rate</FieldLabel>
            <Select
              value={String(resolved.pollHz)}
              disabled={isPending(POLL_KEY)}
              onValueChange={(v) => save(POLL_KEY, { pollHz: Number(v) })}
            >
              <SelectTrigger id={POLL_KEY} className="max-w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {withCurrent(OBD_POLL_HZ_OPTIONS, resolved.pollHz).map((hz) => (
                  <SelectItem key={hz} value={String(hz)}>
                    {hz} Hz{hz === 1 ? " (default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              One cycle reads every selected field once. The vehicle's bus sets the ceiling; a
              slow adapter simply falls behind at higher rates.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel>Fields to poll</FieldLabel>
            <div className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
              {declared.map((f) => {
                const id = `${FIELDS_KEY}-${f}`
                return (
                  <label key={f} htmlFor={id} className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={fieldsDraft.includes(f)}
                      disabled={isPending(FIELDS_KEY)}
                      onCheckedChange={(on) => toggleField(f, on === true)}
                    />
                    <span className="truncate">{metricLabel(`obd.${f}`)}</span>
                  </label>
                )
              })}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isPending(FIELDS_KEY) || !fieldsDirty}
                onClick={() => save(FIELDS_KEY, { fields: fieldsDraft })}
              >
                Apply
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending(FIELDS_KEY) || fieldsDraft.length === 0}
                onClick={() => setFieldsDraft([])}
              >
                Clear
              </Button>
            </div>
            <FieldDescription>
              {declared.length} field{declared.length === 1 ? "" : "s"} declared by the model.
              With none ticked (default) the device polls all of them; tick some to narrow the
              set. Fields the vehicle does not provide are skipped either way.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={POWER_KEY}>Power source</FieldLabel>
            <Select
              value={resolved.powerSource}
              disabled={isPending(POWER_KEY)}
              onValueChange={(v) => save(POWER_KEY, { powerSource: v as ObdPowerSource })}
            >
              <SelectTrigger id={POWER_KEY} className="max-w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POWER_SOURCE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              Switched: the socket dies with the ignition, so polling simply stops when the engine
              does. Hardwired: the device also pauses polling below 11.8 V and resumes above
              12.4 V so it can never drain the battery.
            </FieldDescription>
          </Field>

          <ConfigStatusCallout status={configStatus.obd} />

          {resolved.adapterMac !== null && canForget && (
            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <p className="text-muted-foreground">
                Forget the adapter when it is replaced or the device leaves this vehicle: the
                device drops the Bluetooth bond, polling turns off and the address is cleared.
              </p>
              <Button
                variant="destructive"
                size="sm"
                className={cn("shrink-0")}
                title={offline ? "The device is offline." : undefined}
                disabled={offline || anyPending}
                onClick={() => setForgetOpen(true)}
                data-testid="obd-forget"
              >
                Forget adapter
              </Button>
            </div>
          )}
        </FieldGroup>
      </CardContent>

      <Dialog open={forgetOpen} onOpenChange={forgetting ? undefined : setForgetOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Forget this adapter?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{device.name ?? device.serial}</span>{" "}
              drops its Bluetooth bond with{" "}
              <span className="font-mono text-foreground">{resolved.adapterMac}</span>, stops
              polling, and the address is cleared from these settings. Past sessions keep their
              vehicle data. Setting up again means a new scan or typing the address.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={forgetting}>
                Cancel
              </Button>
            </DialogClose>
            <Button variant="destructive" disabled={forgetting} onClick={runForget}>
              {forgetting ? "Forgetting…" : "Forget adapter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
