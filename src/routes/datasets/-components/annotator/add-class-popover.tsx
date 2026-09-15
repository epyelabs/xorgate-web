import { useEffect, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { Loader2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { xgMessage } from "@/lib/xorgate"
import { updateDataset } from "@/lib/models-api"
import { CLASS_PALETTE, classNameError, MAX_CLASSES, type DatasetClass } from "@/lib/models-schemas"
import { useInvalidateModels } from "@/queries/models"

// Add a class without leaving the annotator. Appends to the dataset's
// ordered list (ids of the existing classes are sent back so nothing is
// renamed or reordered), refreshes the dataset, and hands the new index to
// the caller so it becomes the active class and the next digit key.
export function AddClassPopover({
  datasetId,
  classes,
  onAdded,
  open,
  onOpenChange,
  children,
}: {
  datasetId: string
  classes: DatasetClass[]
  onAdded: (index: number) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  const invalidate = useInvalidateModels()
  const [name, setName] = useState("")
  const [color, setColor] = useState(CLASS_PALETTE[classes.length % CLASS_PALETTE.length])
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setName("")
    setColor(CLASS_PALETTE[classes.length % CLASS_PALETTE.length])
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, classes.length])

  const trimmed = name.trim()
  const error =
    trimmed === ""
      ? null
      : (classNameError(trimmed) ??
        (classes.some((c) => c.name.trim().toLowerCase() === trimmed.toLowerCase()) ? "A class with this name exists" : null))
  const full = classes.length >= MAX_CLASSES
  const canSubmit = trimmed !== "" && !error && !full && !saving

  const submit = async () => {
    if (!canSubmit) return
    setSaving(true)
    try {
      await updateDataset(datasetId, {
        classes: [...classes.map((c) => ({ id: c.id, name: c.name, color: c.color })), { name: trimmed, color }],
      })
      invalidate.dataset(datasetId)
      toast.success(`Class "${trimmed}" added`, {
        description: classes.length < 9 ? `Press ${classes.length + 1} to select it.` : undefined,
      })
      onAdded(classes.length)
      onOpenChange(false)
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-72" onOpenAutoFocus={(e) => {
        e.preventDefault()
        inputRef.current?.focus()
      }}>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          data-testid="add-class-form"
        >
          <p className="text-xs font-medium">New class</p>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color}
              aria-label="Class colour"
              className="h-7 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
              onChange={(e) => setColor(e.target.value)}
            />
            <Input
              ref={inputRef}
              value={name}
              placeholder="e.g. forklift"
              aria-invalid={!!error}
              className="h-7 text-xs"
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              data-testid="add-class-name"
            />
          </div>
          {error ? (
            <span className="text-[10px] text-destructive">{error}</span>
          ) : full ? (
            <span className="text-[10px] text-destructive">This dataset already has {MAX_CLASSES} classes.</span>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              Appended after the existing classes, so their digit keys stay put.
              {classes.length < 9 ? ` The new one gets key ${classes.length + 1}.` : ""}
            </span>
          )}
          <div className="flex justify-end gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit} data-testid="add-class-submit">
              {saving ? <Loader2Icon className="animate-spin" /> : null}
              {saving ? "Adding…" : "Add class"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
