import { useEffect, useState } from "react"
import Editor from "@monaco-editor/react"
import { BracesIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { DeviceModel, IoCapabilities } from "@xorgate/sdk"
import { xg, xgMessage } from "@/lib/xorgate"
import { setupMonaco } from "@/lib/monaco-setup"
import { cn } from "@/lib/utils"

setupMonaco()

type View = "gui" | "json"

// Inspector for a device model: a structured "GUI" view of the model's fields
// + IO capabilities and a raw "JSON" view (Monaco), toggled at the top. The
// model is passed in already-fetched by the caller. When `deviceId` is given
// it also offers model REASSIGNMENT (cm4-support): resolving a `needsModel`
// device, or correcting a wrong model — the backend clears the flag and
// republishes the device config with the new model's hardware block.
export function DeviceModelDialog({
  open,
  onOpenChange,
  model,
  deviceId,
  needsModel,
  onModelChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  model: DeviceModel
  deviceId?: string
  needsModel?: boolean
  onModelChanged?: () => void
}) {
  const [view, setView] = useState<View>("gui")
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-6 p-6 sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <DialogTitle>{model.name}</DialogTitle>
          <DialogDescription>
            {model.sku} · {model.id}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-end gap-2">
          <Label
            htmlFor="model-view-json"
            className="text-xs text-muted-foreground"
          >
            <BracesIcon className="size-3.5" />
            Raw JSON
          </Label>
          <Switch
            id="model-view-json"
            checked={view === "json"}
            onCheckedChange={(checked) => setView(checked ? "json" : "gui")}
          />
        </div>

        {deviceId ? (
          <ChangeModelSection
            deviceId={deviceId}
            currentModelId={model.id}
            needsModel={needsModel === true}
            onChanged={() => {
              onModelChanged?.()
              onOpenChange(false)
            }}
          />
        ) : null}

        {view === "gui" ? (
          <DeviceModelGui model={model} />
        ) : (
          <div className="h-[65vh] overflow-hidden rounded-lg border border-border">
            <Editor
              height="100%"
              defaultLanguage="json"
              value={JSON.stringify(model, null, 2)}
              theme={isDark ? "vs-dark" : "light"}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                lineNumbersMinChars: 3,
                folding: true,
                renderLineHighlight: "none",
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Model reassignment. The catalog loads lazily (tiny, platform-wide). Applying
// PUTs `{deviceModelId}` — `needsModel` clears server-side and the device's
// config republishes with the new model's hardware block, so a fielded device
// re-renders its pipelines with no re-provision.
function ChangeModelSection({
  deviceId,
  currentModelId,
  needsModel,
  onChanged,
}: {
  deviceId: string
  currentModelId: string
  needsModel: boolean
  onChanged: () => void
}) {
  const [catalog, setCatalog] = useState<DeviceModel[] | null>(null)
  const [selected, setSelected] = useState(currentModelId)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const models = await xg().deviceModels.list()
        if (!cancelled) setCatalog(models)
      } catch {
        if (!cancelled) setCatalog([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function apply() {
    setSaving(true)
    try {
      await xg().devices.update(deviceId, { deviceModelId: selected })
      toast.success("Device model updated; the device re-renders its pipelines")
      onChanged()
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3",
        needsModel ? "border-amber-500/50" : "border-border"
      )}
    >
      {needsModel ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          The device's hardware probe could not pick a model unambiguously at
          registration — confirm the right one below.
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            {(catalog ?? []).map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name} · {m.sku}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          disabled={saving || catalog === null || selected === currentModelId}
          onClick={apply}
        >
          {saving ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
          {needsModel ? "Confirm model" : "Change model"}
        </Button>
      </div>
    </section>
  )
}

function DeviceModelGui({ model }: { model: DeviceModel }) {
  const caps = model.ioCapabilities
  return (
    <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
      <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <SectionTitle>Basics</SectionTitle>
        <Field label="Name" value={model.name} />
        <Field label="SKU" value={model.sku} />
        <Field label="Model ID" value={model.id} mono />
        <Field label="Firmware channel" value={model.firmwareChannel ?? "—"} />
        <Field
          label="Updated"
          value={new Date(model.updatedAt).toLocaleString()}
        />
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <SectionTitle>Capabilities</SectionTitle>
        {caps ? (
          <Capabilities caps={caps} />
        ) : (
          <p className="text-xs text-muted-foreground">
            No capabilities defined.
          </p>
        )}
      </section>
    </div>
  )
}

function Capabilities({ caps }: { caps: IoCapabilities }) {
  const video = caps.media?.video ?? []
  const imu = caps.sensors?.imu
  const accel = imu?.accel ?? imu?.axes
  // schemaVersion-2 platform facts (cm4-support). Typed loosely because the
  // installed SDK may predate v2; a v1 doc simply has none of these.
  const sys = caps.system as
    | {
        platform?: string
        encoder?: string
        rails?: boolean
        statusLed?: { r: number; g: number; b: number } | null
      }
    | undefined
  // v2 peripherals (obd2-bluetooth-integration): an OBD-II reader the model
  // expects on every kit. Its Bluetooth address is a device setting, not here.
  const obd = caps.schemaVersion === 2 ? caps.peripherals?.obd : undefined

  return (
    <div className="flex flex-col gap-2">
      {sys?.platform ? <Field label="Platform" value={sys.platform} /> : null}
      {sys?.encoder ? <Field label="Encoder" value={sys.encoder} /> : null}
      {sys?.platform ? (
        <Field label="Power rails" value={sys.rails ? "PMIC telemetry" : "none"} />
      ) : null}
      {sys?.platform ? (
        <Field
          label="Status LED"
          value={
            sys.statusLed
              ? `GPIO r${sys.statusLed.r} g${sys.statusLed.g} b${sys.statusLed.b}`
              : "not wired"
          }
        />
      ) : null}
      {video.length > 0 ? (
        <Chips
          label="Video"
          items={video.map((v) => {
            const conn = (v as { connector?: string }).connector
            const base = v.label ?? v.key
            return conn ? `${base} (${conn})` : base
          })}
        />
      ) : null}
      <Chips label="IMU accel" items={accel} />
      <Chips label="IMU quaternion" items={imu?.quaternion} />
      <Chips label="IMU euler" items={imu?.euler} />
      {caps.comm?.module ? (
        <Field label="Comm module" value={caps.comm.module} />
      ) : null}
      <Chips label="GPS fields" items={caps.comm?.gps?.fields} />
      <Chips label="Signal fields" items={caps.comm?.signal?.fields} />
      <Chips label="System fields" items={caps.system?.fields} />
      {obd ? (
        <>
          <Field label="OBD adapter" value={obd.adapter} />
          <Field label="OBD transport" value={obd.transport} />
          <Field
            label="OBD poll rate"
            value={`${obd.rateHz ?? 1} Hz${obd.rateHz == null ? " (default)" : ""}`}
          />
          <Chips
            label={`OBD fields (${obd.fields.length})`}
            items={obd.fields}
          />
          <Chips label="OBD info" items={obd.info} />
        </>
      ) : null}
    </div>
  )
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </h3>
  )
}

function Field({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-32 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-sm text-foreground",
          mono && "font-mono text-xs break-all"
        )}
      >
        {value}
      </span>
    </div>
  )
}

function Chips({ label, items }: { label: string; items?: string[] }) {
  if (!items || items.length === 0) return null
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-32 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <Badge key={item} variant="secondary">
            {item}
          </Badge>
        ))}
      </div>
    </div>
  )
}
