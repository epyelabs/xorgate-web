import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createWorkflowTemplate } from "@/lib/workflow-templates-api"
import { createWorkflowTemplateSchema } from "@/lib/workflow-schemas"

// Minimal create flow: name + optional description, then jump straight into the
// new template's editor (which opens on its empty draft).
export function CreateTemplateDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setName("")
    setDescription("")
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = createWorkflowTemplateSchema.safeParse({
      name,
      description: description.trim() === "" ? undefined : description,
    })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input")
      return
    }
    setSubmitting(true)
    try {
      const { template } = await createWorkflowTemplate(parsed.data)
      toast.success("Template created")
      reset()
      onOpenChange(false)
      navigate({ to: "/workflow-templates/$id", params: { id: template.id } })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New workflow template</DialogTitle>
          <DialogDescription>
            Start from a blank canvas. You can edit graphically or as JSON.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-name">Name</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Harsh Driving — Sudden Stop"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-desc">Description</Label>
            <Input
              id="tpl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What conclusion does this workflow produce?"
            />
          </div>
          <DialogFooter className="mt-1">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
