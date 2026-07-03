import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { WorkflowTemplateDetail } from "@/lib/workflow-schemas"

// Template metadata editing (name + description). Rendered inside the settings
// side sheet, opened from the header's overflow menu. `onSave` persists via the
// same updateWorkflowTemplate path the header used.
export function SettingsPanel({
  template,
  busy,
  onSave,
}: {
  template: WorkflowTemplateDetail
  busy: boolean
  onSave: (updates: { name: string; description: string | null }) => void
}) {
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description ?? "")

  // Re-sync when the template reloads (e.g. after a save round-trip).
  useEffect(() => {
    setName(template.name)
    setDescription(template.description ?? "")
  }, [template.name, template.description])

  const trimmedName = name.trim()
  const trimmedDescription = description.trim()
  const changed =
    trimmedName !== template.name ||
    trimmedDescription !== (template.description ?? "")
  const canSave = changed && trimmedName.length > 0 && !busy

  const handleSave = () => {
    if (!canSave) return
    onSave({
      name: trimmedName,
      description: trimmedDescription === "" ? null : trimmedDescription,
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="settings-name">Name</Label>
        <Input
          id="settings-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="settings-description">Description</Label>
        <Input
          id="settings-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What conclusion does this workflow produce?"
          maxLength={280}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={!canSave}>
          Save changes
        </Button>
        {changed ? (
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => {
              setName(template.name)
              setDescription(template.description ?? "")
            }}
          >
            Reset
          </button>
        ) : null}
      </div>
    </div>
  )
}
