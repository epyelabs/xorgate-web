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
import { NODE_CATALOG_BY_TYPE } from "@/lib/workflow-nodes"
import { useWorkflowEditor } from "@/store/workflow-editor"

// Right rail of the editor: edit the selected node's label and config. Fields
// are driven by the catalog entry so adding a knob is a data change, not a UI
// change. Shows an empty hint when nothing is selected.
export function NodeProperties() {
  const selectedNodeId = useWorkflowEditor((s) => s.selectedNodeId)
  const node = useWorkflowEditor((s) =>
    s.nodes.find((n) => n.id === s.selectedNodeId),
  )
  const updateNodeLabel = useWorkflowEditor((s) => s.updateNodeLabel)
  const updateNodeConfig = useWorkflowEditor((s) => s.updateNodeConfig)
  const deleteNode = useWorkflowEditor((s) => s.deleteNode)

  if (!selectedNodeId || !node) {
    return (
      <div className="flex h-full w-64 shrink-0 items-center justify-center border-l border-border bg-card/40 p-4 text-center">
        <p className="text-xs text-muted-foreground">
          Select a node to edit its settings, or drag one in from the palette.
        </p>
      </div>
    )
  }

  const entry = NODE_CATALOG_BY_TYPE[node.data.catalogType]
  const config = node.data.config

  return (
    <div className="flex h-full w-64 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-card/40 p-3">
      <div className="flex flex-col gap-1">
        <p className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Node
        </p>
        <p className="text-xs text-muted-foreground">{node.data.catalogType}</p>
      </div>

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
      ) : null}

      {(entry?.fields ?? []).length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          {entry?.fields.map((field) => {
            const value = config[field.key]
            const fieldId = `cfg-${field.key}`
            return (
              <div key={field.key} className="flex flex-col gap-1.5">
                <Label htmlFor={fieldId} className="text-xs">
                  {field.label}
                  {field.unit ? (
                    <span className="ml-1 text-muted-foreground">({field.unit})</span>
                  ) : null}
                </Label>
                {field.type === "select" ? (
                  <Select
                    value={String(value ?? "")}
                    onValueChange={(v) => updateNodeConfig(node.id, field.key, v)}
                  >
                    <SelectTrigger id={fieldId}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(field.options ?? []).map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.type === "number" ? (
                  <Input
                    id={fieldId}
                    type="number"
                    value={value === undefined || value === null ? "" : String(value)}
                    onChange={(e) =>
                      updateNodeConfig(
                        node.id,
                        field.key,
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                ) : (
                  <Input
                    id={fieldId}
                    value={value === undefined || value === null ? "" : String(value)}
                    onChange={(e) => updateNodeConfig(node.id, field.key, e.target.value)}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-auto border-t border-border pt-3">
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
