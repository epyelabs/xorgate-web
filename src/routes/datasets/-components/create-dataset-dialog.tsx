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
import { createDataset } from "@/lib/models-api"
import { xgMessage } from "@/lib/xorgate"
import {
  classNameError,
  DATASET_NAME_MAX,
  MAX_CLASSES,
} from "@/lib/models-schemas"

// Name, optional description, and the initial class list (comma separated;
// colours are assigned server-side from the palette and editable on the
// Classes tab). Jumps into the new dataset on success.
export function CreateDatasetDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [classesText, setClassesText] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const classes = classesText
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
  const classError =
    classes.length === 0
      ? "At least one class is needed"
      : classes.length > MAX_CLASSES
        ? `At most ${MAX_CLASSES} classes`
        : new Set(classes.map((c) => c.toLowerCase())).size !== classes.length
          ? "Class names must be distinct"
          : (classes.map(classNameError).find((e) => e !== null) ?? null)
  const nameError =
    name.trim().length === 0
      ? "Name is required"
      : name.trim().length > DATASET_NAME_MAX
        ? "Name is too long"
        : null

  const reset = () => {
    setName("")
    setDescription("")
    setClassesText("")
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (nameError || classError) {
      toast.error(nameError ?? classError ?? "Invalid input")
      return
    }
    setSubmitting(true)
    try {
      const dataset = await createDataset({
        name: name.trim(),
        description: description.trim() === "" ? undefined : description.trim(),
        classes,
      })
      toast.success("Dataset created")
      reset()
      onOpenChange(false)
      navigate({ to: "/datasets/$id", params: { id: dataset.id } })
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New dataset</DialogTitle>
          <DialogDescription>
            Frames to label for an object detector. Add images by upload or
            from a device recording, then annotate and build a version to train on.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3" data-testid="create-dataset-form">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ds-name">Name</Label>
            <Input
              id="ds-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Yard vehicles"
              autoFocus
              data-testid="dataset-name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ds-desc">Description</Label>
            <Input
              id="ds-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What the frames show and where they come from"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ds-classes">Classes</Label>
            <Input
              id="ds-classes"
              value={classesText}
              onChange={(e) => setClassesText(e.target.value)}
              placeholder="car, truck, forklift"
              data-testid="dataset-classes"
            />
            <p className="text-[11px] text-muted-foreground">
              Comma separated, in the order the hotkeys 1 to 9 will use. You can
              rename, recolour and reorder them later.
            </p>
          </div>
          <DialogFooter className="mt-1">
            <Button type="submit" disabled={submitting} data-testid="dataset-create-submit">
              {submitting ? "Creating…" : "Create dataset"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
