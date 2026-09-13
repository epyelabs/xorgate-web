import { useMemo, useState } from "react"
import { PencilIcon, ListIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { xgMessage } from "@/lib/xorgate"
import { modelRef, parseModelRef, type ModelEntry } from "@/lib/models-schemas"
import { useRegistryModels } from "@/queries/models"

// The `model` field of a node whose catalog entry declares
// `runtime.modelRef` (design §5): a select grouped "Your organization" and
// "Platform", filtered by the node's family, showing label and name@version;
// "pin version" decides whether the config carries `name` (the latest at run
// time, organization first, Q4) or `name@<version>`; "custom name" falls back
// to the free-text input the schema-driven form used to render, for a model
// the registry does not list yet. The picked model's classes show under the
// field so a downstream gate's class chips can be typed correctly.
export function ModelRefField({
  fieldId,
  family,
  value,
  required,
  description,
  setValue,
}: {
  fieldId: string
  family: string
  value: unknown
  required: boolean
  description?: string
  setValue: (v: unknown) => void
}) {
  const modelsQuery = useRegistryModels({ family })
  const models = useMemo(() => (modelsQuery.data?.models ?? []).filter((m) => m.status === "ready"), [modelsQuery.data])
  const text = typeof value === "string" ? value : ""
  const parsed = parseModelRef(text)
  const listed = models.some((m) => m.name === parsed.name)
  const [custom, setCustom] = useState(false)
  const [pin, setPin] = useState(parsed.version !== null)
  const showCustom = custom || (text !== "" && !listed && !modelsQuery.isPending)

  // The registry entry the config names (the pinned version, else the
  // organization's latest, else the platform's), for the classes line.
  const picked: ModelEntry | null = useMemo(() => {
    const byName = models.filter((m) => m.name === parsed.name)
    if (byName.length === 0) return null
    if (parsed.version !== null) return byName.find((m) => m.version === parsed.version) ?? null
    const org = byName.filter((m) => m.scope === "organization").sort((a, b) => b.version - a.version)
    return org[0] ?? byName.sort((a, b) => b.version - a.version)[0]
  }, [models, parsed.name, parsed.version])

  const selectValue = picked ? picked.id : ""
  const choose = (id: string) => {
    const m = models.find((x) => x.id === id)
    if (!m) return
    setValue(modelRef(m.name, pin ? m.version : null))
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="model-ref-field">
      <Label htmlFor={fieldId} className="text-xs">
        Model
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {showCustom ? (
        <div className="flex items-center gap-1">
          <Input
            id={fieldId}
            placeholder="name or name@version"
            value={text}
            onChange={(e) => setValue(e.target.value === "" ? undefined : e.target.value)}
            data-testid="model-ref-custom"
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            title="Pick from the registry"
            aria-label="Pick from the registry"
            onClick={() => setCustom(false)}
          >
            <ListIcon className="size-3" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <Select value={selectValue} onValueChange={choose}>
            <SelectTrigger id={fieldId} className="flex-1" data-testid="model-ref-select">
              <SelectValue placeholder={modelsQuery.isPending ? "Loading registry…" : `Pick a ${family} model`} />
            </SelectTrigger>
            <SelectContent>
              {(["organization", "platform"] as const).map((scope) => {
                const group = models.filter((m) => m.scope === scope)
                if (group.length === 0) return null
                return (
                  <SelectGroup key={scope}>
                    <span className="px-2 py-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                      {scope === "organization" ? "Your organization" : "Platform"}
                    </span>
                    {group.map((m) => (
                      <SelectItem key={m.id} value={m.id} data-testid={`model-ref-option-${m.name}-${m.version}`}>
                        <span className="font-mono text-xs">{modelRef(m.name, m.version)}</span>
                        {m.label && m.label !== m.name ? <span className="ml-1 text-muted-foreground">{m.label}</span> : null}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )
              })}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            title="Type a custom name"
            aria-label="Type a custom name"
            onClick={() => setCustom(true)}
            data-testid="model-ref-custom-toggle"
          >
            <PencilIcon className="size-3" />
          </Button>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Switch
            checked={pin}
            onCheckedChange={(next) => {
              setPin(next)
              if (parsed.name) setValue(modelRef(parsed.name, next ? (picked?.version ?? parsed.version) : null))
            }}
            data-testid="model-ref-pin"
          />
          Pin version
        </label>
        <span className="font-mono text-[10px] text-muted-foreground" data-testid="model-ref-value">
          {text || "—"}
        </span>
      </div>
      {modelsQuery.error ? <span className="text-[11px] text-destructive">Registry: {xgMessage(modelsQuery.error)}</span> : null}
      {picked ? (
        <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 p-1.5" data-testid="model-ref-classes">
          <span className="text-[10px] text-muted-foreground">
            {picked.scope === "organization" ? "Organization model" : "Platform model"} · {picked.classNames.length} classes
            {!pin ? " · latest version at run time" : ""}
          </span>
          <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
            {picked.classNames.map((c) => (
              <span key={c} className="rounded border border-border px-1 py-0.5 font-mono text-[10px]">
                {c}
              </span>
            ))}
          </div>
        </div>
      ) : text && !modelsQuery.isPending ? (
        <span className="text-[11px] text-muted-foreground">Not in the registry; publish will warn if no root resolves it.</span>
      ) : null}
      {description ? <p className="text-[11px] leading-snug text-muted-foreground">{description}</p> : null}
    </div>
  )
}
