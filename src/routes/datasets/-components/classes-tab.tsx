import { useEffect, useState } from "react"
import { toast } from "sonner"
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { xgMessage } from "@/lib/xorgate"
import { updateDataset } from "@/lib/models-api"
import {
  CLASS_PALETTE,
  classNameError,
  MAX_CLASSES,
  type DatasetClass,
  type DatasetDetail,
} from "@/lib/models-schemas"
import { useInvalidateModels } from "@/queries/models"

// The ordered class list with colours. Order matters: it is what the
// annotator's digit keys follow and the order a version's COCO categories
// take. Ids survive a rename, recolour or reorder; a class with annotations
// cannot be deleted (the backend refuses, and the row says why first).
interface Draft {
  id?: string
  name: string
  color: string
}

function toDraft(classes: DatasetClass[]): Draft[] {
  return classes.map((c) => ({ id: c.id, name: c.name, color: c.color }))
}

export function ClassesTab({ dataset, canEdit }: { dataset: DatasetDetail; canEdit: boolean }) {
  const canonical = JSON.stringify(toDraft(dataset.classes))
  const [rows, setRows] = useState<Draft[]>(() => JSON.parse(canonical) as Draft[])
  const [saving, setSaving] = useState(false)
  const invalidate = useInvalidateModels()

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setRows(JSON.parse(canonical) as Draft[])
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [canonical])

  const dirty = JSON.stringify(rows) !== canonical
  const names = rows.map((r) => r.name.trim().toLowerCase())
  const errors = rows.map((r, i) => {
    const e = classNameError(r.name)
    if (e) return e
    if (names.indexOf(r.name.trim().toLowerCase()) !== i) return "Duplicate name"
    return null
  })
  const valid = rows.length > 0 && rows.length <= MAX_CLASSES && errors.every((e) => e === null)

  const update = (i: number, patch: Partial<Draft>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const move = (i: number, dir: -1 | 1) =>
    setRows((prev) => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  const remove = (i: number) => setRows((prev) => prev.filter((_, j) => j !== i))
  const add = () =>
    setRows((prev) => [...prev, { name: "", color: CLASS_PALETTE[prev.length % CLASS_PALETTE.length] }])

  const save = async () => {
    setSaving(true)
    try {
      await updateDataset(dataset.id, {
        classes: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name.trim(), color: r.color })),
      })
      toast.success("Classes saved")
      invalidate.dataset(dataset.id)
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" data-testid="classes-tab">
      <p className="text-xs text-muted-foreground">
        The order here is the order the annotator's keys 1 to 9 use. A class with
        annotations can be renamed or recoloured but not removed.
      </p>
      <div className="flex max-w-2xl flex-col gap-1.5">
        {rows.map((row, i) => {
          const used = row.id ? (dataset.classUsage[row.id] ?? 0) : 0
          return (
            <div
              key={row.id ?? `new-${i}`}
              className="grid items-center gap-2"
              style={{ gridTemplateColumns: "1.5rem 2.25rem minmax(0,1fr) 6rem auto" }}
              data-testid="class-row"
            >
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{i < 9 ? i + 1 : ""}</span>
              <input
                type="color"
                value={row.color}
                disabled={!canEdit}
                aria-label={`${row.name || "class"} colour`}
                className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
                onChange={(e) => update(i, { color: e.target.value })}
              />
              <div className="flex flex-col">
                <Input
                  value={row.name}
                  disabled={!canEdit}
                  placeholder="class name"
                  aria-invalid={errors[i] !== null}
                  className="h-7 text-xs"
                  onChange={(e) => update(i, { name: e.target.value })}
                />
                {errors[i] ? <span className="text-[10px] text-destructive">{errors[i]}</span> : null}
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {used} box{used === 1 ? "" : "es"}
              </span>
              <span className="flex items-center gap-0.5">
                <Button type="button" variant="ghost" size="icon-sm" disabled={!canEdit || i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  <ArrowUpIcon className="size-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!canEdit || i === rows.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label="Move down"
                >
                  <ArrowDownIcon className="size-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!canEdit || used > 0 || rows.length === 1}
                  title={used > 0 ? "Delete the annotations first" : "Remove"}
                  onClick={() => remove(i)}
                  aria-label="Remove class"
                >
                  <XIcon className={cn("size-3", used > 0 ? "opacity-40" : "")} />
                </Button>
              </span>
            </div>
          )
        })}
      </div>
      {canEdit ? (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={add} disabled={rows.length >= MAX_CLASSES}>
            <PlusIcon />
            Add class
          </Button>
          <Button type="button" size="sm" disabled={!dirty || !valid || saving} onClick={() => void save()} data-testid="classes-save">
            {saving ? "Saving…" : "Save classes"}
          </Button>
          {dirty ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setRows(JSON.parse(canonical) as Draft[])}>
              Discard
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
