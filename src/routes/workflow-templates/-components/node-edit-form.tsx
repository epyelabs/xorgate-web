import { Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { useWorkflowCatalog } from "@/store/workflow-catalog"
import { useWorkflowEditor } from "@/store/workflow-editor"

// The node editor body, rendered inside the per-node popover. Fields are
// GENERATED from the served catalog's per-node config JSON Schema (drafted from
// the backend zod via zod-to-json-schema), so the form always matches what
// publish validation will accept. Covers the shapes the M1 catalog emits:
// number/integer, string, string enum, boolean, string array, enum array.

// Loose structural view of a JSON Schema property (draft-07 subset).
interface PropSchema {
  type?: string
  enum?: unknown[]
  default?: unknown
  description?: string
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  items?: { type?: string; enum?: unknown[] }
}

interface ObjectSchema {
  properties?: Record<string, PropSchema>
  required?: string[]
}

// Visualization overlay options are filtered by which tagged inputs are
// connected (architecture §3.3: the multi-select is ordinary config whose
// options depend on connections). Each option lists the input port ids that
// make it meaningful; an option shows when ANY of them has an edge. Backend
// executors log-and-skip unavailable overlays, so this is editor ergonomics,
// not validation.
const VISUALIZATION_OVERLAY_PORTS: Record<string, string[]> = {
  boxes: ["detections"],
  confidence: ["detections"],
  labels: ["detections", "segments"],
  depth_map: ["depth"],
  masks: ["segments"],
}

// "minConfidence" -> "Min confidence", "cacheTtlSeconds" -> "Cache ttl seconds"
function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
}

function ConfigField({
  nodeId,
  fieldKey,
  schema,
  required,
  value,
  enumFilter,
}: {
  nodeId: string
  fieldKey: string
  schema: PropSchema
  required: boolean
  value: unknown
  /** Optional per-option gate for enum-array fields (overlay filtering). */
  enumFilter?: (option: string) => boolean
}) {
  const updateNodeConfig = useWorkflowEditor((s) => s.updateNodeConfig)
  const fieldId = `cfg-${fieldKey}`
  const setValue = (v: unknown) => updateNodeConfig(nodeId, fieldKey, v)

  let control: React.ReactNode
  if (schema.enum) {
    // String enum -> select.
    control = (
      <Select
        value={String(value ?? schema.default ?? "")}
        onValueChange={(v) => setValue(v)}
      >
        <SelectTrigger id={fieldId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {schema.enum.map((opt) => (
            <SelectItem key={String(opt)} value={String(opt)}>
              {String(opt)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  } else if (schema.type === "boolean") {
    control = (
      <Switch
        id={fieldId}
        checked={Boolean(value ?? schema.default ?? false)}
        onCheckedChange={(checked) => setValue(checked)}
      />
    )
  } else if (schema.type === "number" || schema.type === "integer") {
    control = (
      <Input
        id={fieldId}
        type="number"
        min={schema.minimum ?? schema.exclusiveMinimum}
        max={schema.maximum}
        step={schema.type === "integer" ? 1 : "any"}
        placeholder={schema.default !== undefined ? String(schema.default) : undefined}
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) =>
          setValue(e.target.value === "" ? undefined : Number(e.target.value))
        }
      />
    )
  } else if (schema.type === "array" && schema.items?.enum) {
    // Enum array (e.g. visualization overlays) -> toggle chips. Options an
    // enumFilter rejects are hidden but still-selected values are preserved.
    const selected = new Set(asStringArray(value ?? schema.default))
    const options = schema.items.enum.filter(
      (opt) => !enumFilter || enumFilter(String(opt)) || selected.has(String(opt)),
    )
    control = (
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const key = String(opt)
          const on = selected.has(key)
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => {
                const next = new Set(selected)
                if (on) next.delete(key)
                else next.add(key)
                setValue([...next])
              }}
              className={cn(
                "rounded-md border px-2 py-1 text-[11px] transition-colors",
                on
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {key}
            </button>
          )
        })}
      </div>
    )
  } else if (schema.type === "array") {
    // String array (metrics, classes) -> comma-separated text input.
    control = (
      <Input
        id={fieldId}
        placeholder="comma, separated, values"
        value={asStringArray(value).join(", ")}
        onChange={(e) => {
          const items = e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
          setValue(items.length > 0 ? items : undefined)
        }}
      />
    )
  } else {
    // Strings and anything unrecognized.
    control = (
      <Input
        id={fieldId}
        placeholder={schema.default !== undefined ? String(schema.default) : undefined}
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) => setValue(e.target.value === "" ? undefined : e.target.value)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId} className="text-xs">
        {humanize(fieldKey)}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {control}
      {schema.description ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {schema.description}
        </p>
      ) : null}
    </div>
  )
}

export function NodeEditForm({ nodeId }: { nodeId: string }) {
  const node = useWorkflowEditor((s) => s.nodes.find((n) => n.id === nodeId))
  const edges = useWorkflowEditor((s) => s.edges)
  const updateNodeLabel = useWorkflowEditor((s) => s.updateNodeLabel)
  const deleteNode = useWorkflowEditor((s) => s.deleteNode)
  const entry = useWorkflowCatalog((s) =>
    node ? s.byType[node.data.catalogType] : undefined,
  )

  if (!node) return null

  const config = node.data.config
  const objectSchema = (entry?.configSchema ?? {}) as ObjectSchema
  const properties = Object.entries(objectSchema.properties ?? {})
  const requiredKeys = new Set(objectSchema.required ?? [])

  // Visualization overlays: only offer layers whose tagged input is connected.
  // New edges always carry explicit port-id handles; a legacy null handle
  // disables filtering rather than hiding options on a guess.
  let overlayFilter: ((option: string) => boolean) | undefined
  if (node.data.catalogType === "output.visualization") {
    const incoming = edges.filter((e) => e.target === node.id)
    if (incoming.every((e) => typeof e.targetHandle === "string")) {
      const connected = new Set(incoming.map((e) => e.targetHandle as string))
      overlayFilter = (option) =>
        (VISUALIZATION_OVERLAY_PORTS[option] ?? []).some((port) => connected.has(port))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Node
        </p>
        <p className="text-xs text-muted-foreground">{node.data.catalogType}</p>
      </div>

      <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="node-label" className="text-xs">
            Label
          </Label>
          <Input
            id="node-label"
            value={node.data.label}
            onChange={(e) => updateNodeLabel(node.id, e.target.value)}
          />
        </div>

        {entry?.description ? (
          <p className="text-[11px] text-muted-foreground">{entry.description}</p>
        ) : (
          <p className="text-[11px] text-destructive">
            Unknown node type — not in the served catalog. It will fail publish
            validation.
          </p>
        )}

        {entry?.ui.editor ? (
          <p className="rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground">
            This node gets a rich {entry.ui.editor} editor in a later milestone;
            plain fields below for now.
          </p>
        ) : null}

        {properties.map(([key, schema]) => (
          <ConfigField
            key={key}
            nodeId={node.id}
            fieldKey={key}
            schema={schema}
            required={requiredKeys.has(key)}
            value={config[key]}
            enumFilter={key === "overlays" ? overlayFilter : undefined}
          />
        ))}
      </div>

      <div className="border-t border-border pt-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full text-destructive hover:text-destructive"
          onClick={() => deleteNode(node.id)}
        >
          <Trash2Icon />
          Delete node
        </Button>
      </div>
    </div>
  )
}
