import { useEffect, useState } from "react"
import { PlusIcon, SquareFunctionIcon, Trash2Icon, XIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
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
import { Textarea } from "@/components/ui/textarea"
import { FUNCTION_NODE_RUNTIMES } from "@/lib/code-function-runtime"
import { readFunctionConfig } from "@/lib/code-function-runtime"
import { cn } from "@/lib/utils"
import { useWorkflowCatalog } from "@/store/workflow-catalog"
import { useWorkflowEditor } from "@/store/workflow-editor"

// The node editor body, rendered inside the per-node popover. Fields are
// GENERATED from the served catalog's per-node config JSON Schema (drafted from
// the backend zod via zod-to-json-schema), so the form always matches what
// publish validation will accept. Covers the shapes the M1 catalog emits:
// number/integer, string, string enum, boolean, string array, enum array,
// and arrays of objects (a geofence polygon: one `lat, lng` vertex per line).

// Loose structural view of a JSON Schema property (draft-07 subset).
interface PropSchema {
  type?: string
  enum?: unknown[]
  default?: unknown
  description?: string
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  minItems?: number
  items?: {
    type?: string
    enum?: unknown[]
    properties?: Record<string, PropSchema>
  }
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

// Config keys the full-screen code function editor owns; the generic form
// never renders them as plain fields.
const CODE_EDITOR_KEYS = new Set(["code", "versions", "deployedVersion"])

// "minConfidence" -> "Min confidence", "cacheTtlSeconds" -> "Cache ttl seconds"
function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : []
}

// --- Arrays of objects --------------------------------------------------------
// The generic string-array input cannot hold these (it would render nothing
// and, worse, overwrite the objects with strings on the first keystroke). An
// object array whose item properties are all primitive (a geofence polygon:
// { lat, lng }) is edited as a numbered list of rows, one input per property,
// with add / remove. Cells keep a local text draft so "-" or "43." can be
// typed; the config updates only with fully parsed rows, so a half-typed cell
// never corrupts the definition.

const NUMERIC_TYPES = new Set(["number", "integer"])

function itemKeys(schema: PropSchema): string[] | null {
  const props = schema.items?.properties
  if (!props) return null
  const keys = Object.keys(props)
  if (keys.length === 0) return null
  const primitive = keys.every(
    (k) => NUMERIC_TYPES.has(props[k].type ?? "") || props[k].type === "string"
  )
  return primitive ? keys : null
}

// "polygon" with { lat, lng } rows -> "vertex"; anything else -> "item".
function itemNoun(keys: string[]): string {
  return keys.length === 2 && keys.includes("lat") && keys.includes("lng")
    ? "vertex"
    : "item"
}

function plural(noun: string, n: number): string {
  if (n === 1) return noun
  return noun === "vertex" ? "vertices" : `${noun}s`
}

type Row = Record<string, string>

function rowsFromValue(value: unknown, keys: string[]): Row[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const obj = (item && typeof item === "object" ? item : {}) as Record<
      string,
      unknown
    >
    return Object.fromEntries(
      keys.map((k) => [
        k,
        obj[k] === undefined || obj[k] === null ? "" : String(obj[k]),
      ])
    )
  })
}

function parseRows(
  rows: Row[],
  props: Record<string, PropSchema>
): Record<string, unknown>[] | null {
  const out: Record<string, unknown>[] = []
  for (const row of rows) {
    const item: Record<string, unknown> = {}
    for (const [k, text] of Object.entries(row)) {
      const t = text.trim()
      if (t === "") return null
      if (NUMERIC_TYPES.has(props[k].type ?? "")) {
        const n = Number(t)
        if (!Number.isFinite(n)) return null
        item[k] = n
      } else item[k] = t
    }
    out.push(item)
  }
  return out
}

function ObjectListField({
  fieldId,
  schema,
  value,
  setValue,
}: {
  fieldId: string
  schema: PropSchema
  value: unknown
  setValue: (v: unknown) => void
}) {
  const props = schema.items?.properties ?? {}
  const keys = Object.keys(props)
  const noun = itemNoun(keys)
  const canonicalKey = JSON.stringify(rowsFromValue(value, keys))
  const [rows, setRows] = useState<Row[]>(
    () => JSON.parse(canonicalKey) as Row[]
  )
  // Resync when the stored value changes from elsewhere (paste, undo, another node).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setRows(JSON.parse(canonicalKey) as Row[])
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [canonicalKey])

  const commit = (next: Row[]) => {
    setRows(next)
    const parsed = parseRows(next, props)
    if (parsed) setValue(parsed.length > 0 ? parsed : undefined)
  }
  const incomplete = parseRows(rows, props) === null
  const min = schema.minItems ?? 0
  const tooFew = rows.length < min

  return (
    <div className="flex flex-col gap-1.5" data-testid={`${fieldId}-list`}>
      {rows.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div
            className="grid items-center gap-1 pr-7 pl-6 text-[10px] font-medium text-muted-foreground uppercase"
            style={{
              gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))`,
            }}
          >
            {keys.map((k) => (
              <span key={k}>{k}</span>
            ))}
          </div>
          {rows.map((row, i) => (
            <div
              key={i}
              className="grid items-center gap-1"
              style={{
                gridTemplateColumns: `1.25rem repeat(${keys.length}, minmax(0, 1fr)) 1.5rem`,
              }}
              data-testid={`${fieldId}-row-${i}`}
            >
              <span className="font-mono text-[10px] text-muted-foreground">
                {i + 1}
              </span>
              {keys.map((k) => (
                <Input
                  key={k}
                  id={i === 0 && k === keys[0] ? fieldId : undefined}
                  type={
                    NUMERIC_TYPES.has(props[k].type ?? "") ? "number" : "text"
                  }
                  step="any"
                  min={props[k].minimum}
                  max={props[k].maximum}
                  aria-label={`${noun} ${i + 1} ${k}`}
                  className="h-7 font-mono text-xs"
                  value={row[k]}
                  onChange={(e) =>
                    commit(
                      rows.map((r, j) =>
                        j === i ? { ...r, [k]: e.target.value } : r
                      )
                    )
                  }
                />
              ))}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${noun} ${i + 1}`}
                title={`Remove ${noun}`}
                onClick={() => commit(rows.filter((_, j) => j !== i))}
              >
                <XIcon className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "text-[11px]",
            incomplete || tooFew ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {incomplete
            ? `Fill in every ${keys.join(" and ")} to apply`
            : tooFew
              ? `${rows.length} ${plural(noun, rows.length)} (at least ${min} needed)`
              : `${rows.length} ${plural(noun, rows.length)}`}
        </span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() =>
            commit([...rows, Object.fromEntries(keys.map((k) => [k, ""]))])
          }
        >
          <PlusIcon className="size-3" />
          Add {noun}
        </Button>
      </div>
    </div>
  )
}

// Object arrays whose items are NOT all primitive fall back to raw JSON, one
// object per line (none in the catalog today).
function JsonLinesField({
  fieldId,
  value,
  setValue,
}: {
  fieldId: string
  value: unknown
  setValue: (v: unknown) => void
}) {
  const canonical = Array.isArray(value)
    ? value.map((v) => JSON.stringify(v)).join("\n")
    : ""
  const [draft, setDraft] = useState(canonical)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setDraft(canonical)
    setError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [canonical])
  return (
    <div className="flex flex-col gap-1">
      <Textarea
        id={fieldId}
        rows={4}
        className="font-mono text-xs"
        placeholder="one JSON object per line"
        aria-invalid={error !== null}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          const items: unknown[] = []
          const lines = e.target.value
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
          for (const [i, line] of lines.entries()) {
            try {
              const obj = JSON.parse(line) as unknown
              if (!obj || typeof obj !== "object" || Array.isArray(obj))
                throw new Error("not an object")
              items.push(obj)
            } catch {
              setError(`Line ${i + 1}: expected a JSON object`)
              return
            }
          }
          setError(null)
          setValue(items.length > 0 ? items : undefined)
        }}
      />
      {error ? (
        <span className="text-[11px] text-destructive">{error}</span>
      ) : null}
    </div>
  )
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
        placeholder={
          schema.default !== undefined ? String(schema.default) : undefined
        }
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
      (opt) =>
        !enumFilter || enumFilter(String(opt)) || selected.has(String(opt))
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
                  : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              {key}
            </button>
          )
        })}
      </div>
    )
  } else if (schema.type === "array" && schema.items?.type === "object") {
    // Object array (geofence polygon) -> a numbered list of rows, one input
    // per property; raw JSON lines only for non-primitive item shapes.
    control = itemKeys(schema) ? (
      <ObjectListField
        fieldId={fieldId}
        schema={schema}
        value={value}
        setValue={setValue}
      />
    ) : (
      <JsonLinesField fieldId={fieldId} value={value} setValue={setValue} />
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
        placeholder={
          schema.default !== undefined ? String(schema.default) : undefined
        }
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) =>
          setValue(e.target.value === "" ? undefined : e.target.value)
        }
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

// Compact summary + entry point for Code Function nodes: the code itself is
// edited/tested/monitored/versioned in the full-screen function editor, not
// in this popover. Opening it also deselects the node so the popover closes.
function CodeFunctionSummary({
  nodeId,
  catalogType,
}: {
  nodeId: string
  catalogType: string
}) {
  const node = useWorkflowEditor((s) => s.nodes.find((n) => n.id === nodeId))
  const openFunctionEditor = useWorkflowEditor((s) => s.openFunctionEditor)
  const selectNode = useWorkflowEditor((s) => s.selectNode)
  const runtime = FUNCTION_NODE_RUNTIMES[catalogType]
  if (!node || !runtime) return null

  const fn = readFunctionConfig(catalogType, node.data.config)
  const lines = fn.code.split("\n").length
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{runtime.runtimeLabel}</Badge>
        <Badge variant="secondary">
          {fn.deployedVersion !== null
            ? `Live: v${fn.deployedVersion}`
            : "Not deployed"}
        </Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {runtime.fileName} · {lines} lines · handler <code>{fn.handler}</code>
      </p>
      <Button
        size="sm"
        onClick={() => {
          openFunctionEditor(nodeId)
          selectNode(null)
        }}
      >
        <SquareFunctionIcon />
        Open function editor
      </Button>
    </div>
  )
}

export function NodeEditForm({ nodeId }: { nodeId: string }) {
  const node = useWorkflowEditor((s) => s.nodes.find((n) => n.id === nodeId))
  const edges = useWorkflowEditor((s) => s.edges)
  const updateNodeLabel = useWorkflowEditor((s) => s.updateNodeLabel)
  const deleteNode = useWorkflowEditor((s) => s.deleteNode)
  const entry = useWorkflowCatalog((s) =>
    node ? s.byType[node.data.catalogType] : undefined
  )

  if (!node) return null

  const config = node.data.config
  const objectSchema = (entry?.configSchema ?? {}) as ObjectSchema
  // Code function nodes: the served schema carries `code`, `versions` and
  // `deployedVersion` (the engine's full config), which the function editor
  // owns (Code / Versions tabs); the popover keeps the plain knobs only.
  const properties = Object.entries(objectSchema.properties ?? {}).filter(
    ([key]) => entry?.ui.editor !== "code" || !CODE_EDITOR_KEYS.has(key)
  )
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
        (VISUALIZATION_OVERLAY_PORTS[option] ?? []).some((port) =>
          connected.has(port)
        )
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
          <p className="text-[11px] text-muted-foreground">
            {entry.description}
          </p>
        ) : (
          <p className="text-[11px] text-destructive">
            Unknown node type — not in the served catalog. It will fail publish
            validation.
          </p>
        )}

        {entry?.ui.editor === "code" ? (
          <CodeFunctionSummary
            nodeId={node.id}
            catalogType={node.data.catalogType}
          />
        ) : entry?.ui.editor ? (
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
