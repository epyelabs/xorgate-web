import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Segmented } from "@/routes/devices/-components/trigger-editors"
import { xgMessage } from "@/lib/xorgate"
import { apiErrorCode, apiErrorDetails, createTrainingJob } from "@/lib/models-api"
import {
  DEFAULT_MAX_MINUTES,
  MAX_MAX_MINUTES,
  modelNameError,
  RECIPES,
  TRAINING_ESTIMATES,
  type DatasetVersion,
  type TrainingMode,
  type TrainingTarget,
} from "@/lib/models-schemas"
import { useInvalidateModels, useRegistryModels } from "@/queries/models"

// The Train dialog (design §5): recipe with its license line, base weights,
// the output name validated as you type (the engine's own name rule; a name
// the platform already serves is refused, Q4; an existing organization name
// becomes "new version of"), label, mode, target with the static duration and
// cost line, and the container's minute budget. Handles the two refusals the
// backend can answer after validation: 409 TRAINING_JOB_IN_FLIGHT (one job per
// organization) and 400 MODEL_NAME_TAKEN.
export function TrainDialog({
  datasetName,
  version,
  open,
  onOpenChange,
}: {
  datasetName: string
  version: DatasetVersion | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const invalidate = useInvalidateModels()
  const modelsQuery = useRegistryModels({ family: "detection", includeArchived: true })
  const models = useMemo(() => modelsQuery.data?.models ?? [], [modelsQuery.data])

  const [recipeId, setRecipeId] = useState(RECIPES[0].id)
  const recipe = RECIPES.find((r) => r.id === recipeId) ?? RECIPES[0]
  const [base, setBase] = useState<string>(RECIPES[0].bases[0])
  const [name, setName] = useState("")
  const [label, setLabel] = useState("")
  const [mode, setMode] = useState<TrainingMode>("fast")
  const [target, setTarget] = useState<TrainingTarget>("cpu")
  const [maxMinutes, setMaxMinutes] = useState(String(DEFAULT_MAX_MINUTES))
  const [epochs, setEpochs] = useState("")
  const [imgsz, setImgsz] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [serverNameError, setServerNameError] = useState<string | null>(null)
  const [inFlight, setInFlight] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setServerNameError(null)
    setInFlight(null)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open])

  const trimmed = name.trim()
  const localNameError = trimmed ? modelNameError(trimmed) : "Model name is required"
  const platformHit = models.find((m) => m.scope === "platform" && m.name === trimmed)
  const orgVersions = models
    .filter((m) => m.scope === "organization" && m.name === trimmed)
    .map((m) => m.version)
  const nextVersion = orgVersions.length ? Math.max(...orgVersions) + 1 : 1
  const nameError =
    serverNameError ??
    localNameError ??
    (platformHit ? `"${trimmed}" is a platform model name; organization models may not shadow it` : null)

  const minutes = Number(maxMinutes)
  const minutesOk = Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_MAX_MINUTES
  const epochsN = epochs.trim() === "" ? undefined : Number(epochs)
  const imgszN = imgsz.trim() === "" ? undefined : Number(imgsz)
  const epochsOk = epochsN === undefined || (Number.isInteger(epochsN) && epochsN >= 1 && epochsN <= 1000)
  const imgszOk = imgszN === undefined || (Number.isInteger(imgszN) && imgszN >= 32 && imgszN <= 1920)
  const canSubmit = !!version && !nameError && minutesOk && epochsOk && imgszOk && !submitting

  const est = TRAINING_ESTIMATES[target]

  const submit = async () => {
    if (!version || nameError) return
    setSubmitting(true)
    setServerNameError(null)
    setInFlight(null)
    try {
      const hyperparameters =
        epochsN !== undefined || imgszN !== undefined
          ? { ...(epochsN !== undefined ? { epochs: epochsN } : {}), ...(imgszN !== undefined ? { imgsz: imgszN } : {}) }
          : undefined
      const job = await createTrainingJob({
        datasetVersionId: version.id,
        recipe: recipe.id,
        base: { kind: "pretrained", ref: base },
        output: { name: trimmed, ...(label.trim() ? { label: label.trim() } : {}) },
        mode,
        ...(hyperparameters ? { hyperparameters } : {}),
        target,
        limits: { maxMinutes: minutes },
      })
      toast.success("Training job queued", { description: `${trimmed} v${job.output?.version ?? nextVersion} on ${job.compute?.instanceType ?? target}` })
      invalidate.jobs()
      onOpenChange(false)
      navigate({ to: "/training-jobs/$id", params: { id: job.id } })
    } catch (err) {
      const code = apiErrorCode(err)
      const details = apiErrorDetails(err)
      const jobs = details?.jobs
      if (Array.isArray(jobs) && jobs.length > 0) setInFlight(String(jobs[0]))
      else if (code === "MODEL_NAME_TAKEN" || code === "MODEL_NAME_INVALID" || code === "MODEL_VERSION_TAKEN" || (details && "name" in details)) {
        setServerNameError(xgMessage(err))
      } else toast.error(xgMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Train a model</DialogTitle>
          <DialogDescription>
            {version ? (
              <>
                From <span className="font-medium">{datasetName}</span> v{version.version}
                {version.stats ? ` (${version.stats.images.train} train / ${version.stats.images.val} val images)` : ""}.
                The job runs in the cloud and publishes into this organization's registry.
              </>
            ) : (
              "Pick a ready version first."
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          data-testid="train-form"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Recipe</Label>
              <Select
                value={recipeId}
                onValueChange={(v) => {
                  setRecipeId(v)
                  const r = RECIPES.find((x) => x.id === v)
                  if (r && !r.bases.includes(base)) setBase(r.bases[0])
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECIPES.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-[11px] text-muted-foreground" data-testid="recipe-license">
                License: {recipe.license}. The trained model inherits it.
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Base weights</Label>
              <Select value={base} onValueChange={setBase}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {recipe.bases.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-[11px] text-muted-foreground">n is small and fast; s is more accurate and slower.</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="train-name">Model name</Label>
            <Input
              id="train-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setServerNameError(null)
              }}
              placeholder="yard-vehicles"
              aria-invalid={!!nameError && trimmed !== ""}
              autoFocus
              data-testid="train-name"
            />
            {trimmed && nameError ? (
              <span className="text-[11px] text-destructive" data-testid="train-name-error">
                {nameError}
              </span>
            ) : trimmed && orgVersions.length > 0 ? (
              <span className="text-[11px] text-muted-foreground" data-testid="train-name-hint">
                New version of {trimmed}: v{nextVersion} (latest is v{Math.max(...orgVersions)})
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                Letters, digits, ".", "_" or "-". A workflow's detection node names the model by this.
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="train-label">Label</Label>
            <Input id="train-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Optional, shown in the registry" />
          </div>

          <div className="flex flex-wrap items-start gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Mode</Label>
              <Segmented value={mode} onChange={setMode} options={[{ value: "fast", label: "Fast" }, { value: "accurate", label: "Accurate" }]} />
              <span className="max-w-56 text-[11px] text-muted-foreground">{recipe.modes[mode]}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Target</Label>
              <Segmented value={target} onChange={setTarget} options={[{ value: "cpu", label: "CPU" }, { value: "gpu", label: "GPU" }]} />
              <span className="max-w-64 text-[11px] text-muted-foreground" data-testid="train-estimate">
                {est.instanceType}
                {est.spot ? " (spot)" : ""} at ${est.hourlyUsd.toFixed(2)}/h. About {est.duration[mode]} and {est.cost[mode]} for
                1,000 images; a small dataset is minutes.
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="train-minutes">Budget (minutes)</Label>
              <Input id="train-minutes" type="number" min={1} max={MAX_MAX_MINUTES} value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)} aria-invalid={!minutesOk} data-testid="train-minutes" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="train-epochs">Epochs</Label>
              <Input id="train-epochs" type="number" min={1} max={1000} value={epochs} onChange={(e) => setEpochs(e.target.value)} placeholder={mode === "fast" ? "50" : "150"} aria-invalid={!epochsOk} data-testid="train-epochs" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="train-imgsz">Image size</Label>
              <Input id="train-imgsz" type="number" min={32} max={1920} step={32} value={imgsz} onChange={(e) => setImgsz(e.target.value)} placeholder="640" aria-invalid={!imgszOk} data-testid="train-imgsz" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            The budget bounds the container, not the wall clock: provisioning and the image pull
            add about a minute that is not billed. Training stops early inside the budget and still
            exports, checks and evaluates. Epochs and image size override the mode's preset.
          </p>

          {inFlight ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs" data-testid="train-in-flight">
              This organization already has a job in flight; one runs at a time.{" "}
              <Link to="/training-jobs/$id" params={{ id: inFlight }} className="text-primary underline-offset-2 hover:underline">
                Open it
              </Link>{" "}
              to watch or cancel it.
            </p>
          ) : null}

          <DialogFooter className="mt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={!canSubmit} data-testid="train-submit">
              {submitting ? "Starting…" : "Start training"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
