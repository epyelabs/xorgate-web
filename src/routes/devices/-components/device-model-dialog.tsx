import { useState } from "react"
import Editor from "@monaco-editor/react"
import { BracesIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { DeviceModel, IoCapabilities } from "@/lib/api"
import { setupMonaco } from "@/lib/monaco-setup"
import { cn } from "@/lib/utils"

setupMonaco()

type View = "gui" | "json"

// Read-only inspector for a device model. Offers a structured "GUI" view of the
// model's fields + IO capabilities and a raw "JSON" view (Monaco) of the same
// object, toggled at the top. The model is passed in already-fetched by the
// caller, so this component never touches the network.
export function DeviceModelDialog({
  open,
  onOpenChange,
  model,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  model: DeviceModel
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

  return (
    <div className="flex flex-col gap-2">
      {video.length > 0 ? (
        <Chips label="Video" items={video.map((v) => v.label ?? v.key)} />
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
