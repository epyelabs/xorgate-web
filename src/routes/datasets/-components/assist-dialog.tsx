import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { ArrowRightIcon, PlusIcon, XIcon } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Segmented } from "@/routes/devices/-components/trigger-editors"
import { xgMessage } from "@/lib/xorgate"
import { apiErrorCode, apiErrorDetails, createAssistJob } from "@/lib/models-api"
import {
  DEFAULT_ASSIST_MAX_MINUTES,
  MAX_MAX_MINUTES,
  modelRef,
  TRAINING_ESTIMATES,
  type DatasetDetail,
  type ModelEntry,
  type TrainingTarget,
} from "@/lib/models-schemas"
import { useInvalidateModels, useRegistryModels } from "@/queries/models"

// Assist: a registry model labels the unlabeled items as pre-labels
// (`ai_labeled`, dashed in the annotator until accepted). The class map goes
// model class -> dataset class; identity matches are prefilled and anything
// unmapped is counted by the job, not written. Same cost gate as training
// (admin and owner) and the same one-job-per-organization guardrail.
interface MapRow {
  from: string
  to: string
}

export function AssistDialog({
  dataset,
  open,
  onOpenChange,
}: {
  dataset: DatasetDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const invalidate = useInvalidateModels()
  const modelsQuery = useRegistryModels({ family: "detection" })
  const models = useMemo(() => modelsQuery.data?.models ?? [], [modelsQuery.data])
  const [modelId, setModelId] = useState<string>("")
  const [minConfidence, setMinConfidence] = useState("0.4")
  const [items, setItems] = useState<"unlabeled" | "all">("unlabeled")
  const [maxItems, setMaxItems] = useState("500")
  const [target, setTarget] = useState<TrainingTarget>("cpu")
  const [maxMinutes, setMaxMinutes] = useState(String(DEFAULT_ASSIST_MAX_MINUTES))
  const [rows, setRows] = useState<MapRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [inFlight, setInFlight] = useState<string | null>(null)

  const model: ModelEntry | null = models.find((m) => m.id === modelId) ?? null
  const datasetNames = dataset.classes.map((c) => c.name)

  // Default to the platform yolov8n on open; prefill the map by name.
  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setInFlight(null)
    if (!modelId && models.length > 0) {
      const platform = models.find((m) => m.scope === "platform" && m.name === "yolov8n")
      setModelId((platform ?? models[0]).id)
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, models, modelId])

  useEffect(() => {
    if (!model) return
    const lower = new Map(datasetNames.map((n) => [n.toLowerCase(), n]))
    /* eslint-disable react-hooks/set-state-in-effect */
    setRows(
      model.classNames
        .filter((c) => lower.has(c.toLowerCase()))
        .map((c) => ({ from: c, to: lower.get(c.toLowerCase()) as string })),
    )
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.id])

  const conf = Number(minConfidence)
  const confOk = Number.isFinite(conf) && conf >= 0 && conf <= 1
  const minutes = Number(maxMinutes)
  const minutesOk = Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_MAX_MINUTES
  const cap = Number(maxItems)
  const capOk = Number.isInteger(cap) && cap >= 1 && cap <= 500
  const mapOk = rows.every((r) => r.from && r.to) && new Set(rows.map((r) => r.from)).size === rows.length
  const eligible = items === "all" ? dataset.itemCount - (dataset.itemsByStatus.excluded ?? 0) : (dataset.itemsByStatus.unlabeled ?? 0) + (dataset.itemsByStatus.ai_labeled ?? 0)
  const canSubmit = !!model && confOk && minutesOk && capOk && mapOk && rows.length > 0 && eligible > 0 && !submitting

  const submit = async () => {
    if (!model) return
    setSubmitting(true)
    setInFlight(null)
    try {
      const job = await createAssistJob(dataset.id, {
        model: modelRef(model.name, model.version),
        family: model.family,
        minConfidence: conf,
        classMap: Object.fromEntries(rows.map((r) => [r.from, r.to])),
        items,
        maxItems: cap,
        target,
        limits: { maxMinutes: minutes },
      })
      toast.success("Assist job queued", { description: `${model.name}@${model.version} over ${eligible} item(s)` })
      invalidate.jobs()
      onOpenChange(false)
      navigate({ to: "/training-jobs/$id", params: { id: job.id } })
    } catch (err) {
      const details = apiErrorDetails(err)
      const jobs = details?.jobs
      if ((apiErrorCode(err) === "TRAINING_JOB_IN_FLIGHT" || Array.isArray(jobs)) && Array.isArray(jobs) && jobs.length > 0) {
        setInFlight(String(jobs[0]))
      } else toast.error(xgMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const est = TRAINING_ESTIMATES[target]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assist: pre-label with a model</DialogTitle>
          <DialogDescription>
            Runs a registry model over the dataset and writes its boxes as pre-labels.
            Review them in the annotator; nothing a person labeled is touched.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3" data-testid="assist-form">
          <div className="flex flex-col gap-1.5">
            <Label>Model</Label>
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger data-testid="assist-model">
                <SelectValue placeholder={modelsQuery.isPending ? "Loading…" : "Pick a model"} />
              </SelectTrigger>
              <SelectContent>
                {(["organization", "platform"] as const).map((scope) => {
                  const group = models.filter((m) => m.scope === scope && m.status === "ready")
                  if (group.length === 0) return null
                  return (
                    <SelectGroup key={scope}>
                      <span className="px-2 py-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                        {scope === "organization" ? "Your organization" : "Platform"}
                      </span>
                      {group.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}@{m.version}
                          {m.label && m.label !== m.name ? ` · ${m.label}` : ""}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )
                })}
              </SelectContent>
            </Select>
            {model ? (
              <span className="text-[11px] text-muted-foreground">
                {model.classNames.length} classes: {model.classNames.slice(0, 8).join(", ")}
                {model.classNames.length > 8 ? ", …" : ""}
              </span>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Class map (model class to dataset class)</Label>
            <div className="flex flex-col gap-1" data-testid="assist-classmap">
              {rows.map((row, i) => (
                <div key={i} className="grid items-center gap-1" style={{ gridTemplateColumns: "1fr 1.25rem 1fr 1.5rem" }}>
                  <Select value={row.from} onValueChange={(v) => setRows((p) => p.map((r, j) => (j === i ? { ...r, from: v } : r)))}>
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder="model class" />
                    </SelectTrigger>
                    <SelectContent>
                      {(model?.classNames ?? []).map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <ArrowRightIcon className="size-3 text-muted-foreground" />
                  <Select value={row.to} onValueChange={(v) => setRows((p) => p.map((r, j) => (j === i ? { ...r, to: v } : r)))}>
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder="dataset class" />
                    </SelectTrigger>
                    <SelectContent>
                      {datasetNames.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove mapping" onClick={() => setRows((p) => p.filter((_, j) => j !== i))}>
                    <XIcon className="size-3" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">
                  {rows.length === 0 ? "Map at least one class" : `${rows.length} mapping(s); other model classes are counted, not written`}
                </span>
                <Button type="button" variant="outline" size="xs" onClick={() => setRows((p) => [...p, { from: "", to: datasetNames[0] ?? "" }])}>
                  <PlusIcon className="size-3" />
                  Add
                </Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assist-conf">Min confidence</Label>
              <Input id="assist-conf" type="number" min={0} max={1} step={0.05} value={minConfidence} onChange={(e) => setMinConfidence(e.target.value)} aria-invalid={!confOk} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assist-max">At most (items)</Label>
              <Input id="assist-max" type="number" min={1} max={500} value={maxItems} onChange={(e) => setMaxItems(e.target.value)} aria-invalid={!capOk} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="assist-min">Budget (minutes)</Label>
              <Input id="assist-min" type="number" min={1} max={MAX_MAX_MINUTES} value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)} aria-invalid={!minutesOk} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Items</Label>
              <Segmented
                value={items}
                onChange={setItems}
                options={[
                  { value: "unlabeled", label: `Unlabeled (${(dataset.itemsByStatus.unlabeled ?? 0) + (dataset.itemsByStatus.ai_labeled ?? 0)})` },
                  { value: "all", label: "All" },
                ]}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Target</Label>
              <Segmented value={target} onChange={setTarget} options={[{ value: "cpu", label: "CPU" }, { value: "gpu", label: "GPU" }]} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {est.instanceType} at ${est.hourlyUsd.toFixed(2)}/h; labeling a few hundred frames is minutes of
            container time (about $0.04 on CPU), plus a minute of unbilled startup.
          </p>
          {inFlight ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs" data-testid="assist-in-flight">
              This organization already has a job in flight; one runs at a time.{" "}
              <Link to="/training-jobs/$id" params={{ id: inFlight }} className="text-primary underline-offset-2 hover:underline">
                Open it
              </Link>{" "}
              to watch or cancel it.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={!canSubmit} data-testid="assist-submit">
            {submitting ? "Starting…" : "Start assist job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
