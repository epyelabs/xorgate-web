import { useEffect, useState } from "react"
import { toast } from "sonner"
import { TriangleAlertIcon } from "lucide-react"
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
import { Switch } from "@/components/ui/switch"
import { xgMessage } from "@/lib/xorgate"
import { apiErrorCode, apiErrorDetails, createVersion } from "@/lib/models-api"
import {
  versionUnhealthyDetailsSchema,
  type DatasetDetail,
  type VersionHealth,
} from "@/lib/models-schemas"
import { useDatasetVersions, useInvalidateModels } from "@/queries/models"

// "New version": the split ratios, the seed, keep-previous and whether
// unreviewed pre-labels ride along. The preview below the fields is a local
// estimate from the item counts; the authoritative health check runs on the
// POST, and a refusal (400 DATASET_VERSION_UNHEALTHY) renders the backend's
// own errors and warnings in place so nothing is created and nothing is lost.
function HealthBlock({ health }: { health: VersionHealth }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/30 p-2 text-[11px]" data-testid="version-health">
      {health.errors.map((e, i) => (
        <span key={`e${i}`} className="text-destructive">
          {e.message}
        </span>
      ))}
      {health.warnings.map((w, i) => (
        <span key={`w${i}`} className="inline-flex items-center gap-1 text-muted-foreground">
          <TriangleAlertIcon className="size-3 text-amber-500" />
          {w.message}
        </span>
      ))}
    </div>
  )
}

export function NewVersionDialog({
  dataset,
  open,
  onOpenChange,
}: {
  dataset: DatasetDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [message, setMessage] = useState("")
  const [train, setTrain] = useState("80")
  const [val, setVal] = useState("20")
  const [test, setTest] = useState("0")
  const [seed, setSeed] = useState("0")
  const [keepPrevious, setKeepPrevious] = useState(false)
  const [includeAiLabeled, setIncludeAiLabeled] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [refusal, setRefusal] = useState<VersionHealth | null>(null)
  const invalidate = useInvalidateModels()
  const versionsQuery = useDatasetVersions(dataset.id)
  const hasReady = (versionsQuery.data ?? []).some((v) => v.status === "ready")

  useEffect(() => {
    if (open) setRefusal(null)
  }, [open])

  const t = Number(train)
  const v = Number(val)
  const te = Number(test)
  const sum = t + v + te
  const ratiosOk = [t, v, te].every((x) => Number.isFinite(x) && x >= 0) && sum > 0
  const seedOk = /^\d+$/.test(seed)
  const labeled = dataset.itemsByStatus.labeled ?? 0
  const ai = dataset.itemsByStatus.ai_labeled ?? 0
  const eligible = labeled + (includeAiLabeled ? ai : 0)
  const expected = ratiosOk
    ? {
        train: Math.round((eligible * t) / sum),
        val: Math.round((eligible * v) / sum),
        test: Math.round((eligible * te) / sum),
      }
    : null
  const localWarnings: string[] = []
  if (eligible === 0) localWarnings.push("No labeled item to build from")
  else if (eligible < 20) localWarnings.push(`Only ${eligible} image(s); results below 20 are rarely useful`)
  if (expected && eligible > 0 && expected.val === 0) localWarnings.push("The val split would be empty; raise its share")

  const submit = async () => {
    if (!ratiosOk || !seedOk || eligible === 0) return
    setSubmitting(true)
    setRefusal(null)
    try {
      const res = await createVersion(dataset.id, {
        message: message.trim() || undefined,
        split: { train: t / sum, val: v / sum, test: te / sum },
        seed: Number(seed),
        keepPrevious,
        includeAiLabeled,
      })
      toast.success(`Version ${res.version.version} is building`)
      invalidate.dataset(dataset.id)
      onOpenChange(false)
      setMessage("")
    } catch (err) {
      if (apiErrorCode(err) === "DATASET_VERSION_UNHEALTHY" || apiErrorStatusIs400WithHealth(err)) {
        const parsed = versionUnhealthyDetailsSchema.safeParse(apiErrorDetails(err))
        if (parsed.success) {
          setRefusal(parsed.data.health)
          return
        }
      }
      toast.error(xgMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New version</DialogTitle>
          <DialogDescription>
            Freezes the labeled items and their boxes into a train / val / test split.
            Items are grouped (a recording minute, an upload group) so near-duplicates
            never straddle a split.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          data-testid="new-version-form"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ver-msg">Message</Label>
            <Input id="ver-msg" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What changed since the last version" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ver-train">Train %</Label>
              <Input id="ver-train" type="number" min={0} max={100} value={train} onChange={(e) => setTrain(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ver-val">Val %</Label>
              <Input id="ver-val" type="number" min={0} max={100} value={val} onChange={(e) => setVal(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ver-test">Test %</Label>
              <Input id="ver-test" type="number" min={0} max={100} value={test} onChange={(e) => setTest(e.target.value)} />
            </div>
          </div>
          {!ratiosOk ? <span className="text-[11px] text-destructive">Shares must be non-negative and add up to more than zero</span> : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ver-seed">Seed</Label>
              <Input id="ver-seed" type="number" min={0} value={seed} onChange={(e) => setSeed(e.target.value)} aria-invalid={!seedOk} />
            </div>
            <div className="flex flex-col gap-2 pt-5">
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={includeAiLabeled} onCheckedChange={setIncludeAiLabeled} data-testid="include-ai-labeled" />
                Include pre-labeled items ({ai})
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Switch checked={keepPrevious} onCheckedChange={setKeepPrevious} disabled={!hasReady} />
                Keep the previous version's split
              </label>
            </div>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-2 text-[11px]" data-testid="version-preview">
            <span className="font-medium">{eligible}</span> item{eligible === 1 ? "" : "s"} eligible ({labeled} labeled
            {includeAiLabeled ? `, ${ai} pre-labeled` : ""})
            {expected ? (
              <span className="text-muted-foreground">
                {" "}
                · about {expected.train} train / {expected.val} val / {expected.test} test
              </span>
            ) : null}
            {localWarnings.map((w) => (
              <span key={w} className="mt-1 flex items-center gap-1 text-muted-foreground">
                <TriangleAlertIcon className="size-3 text-amber-500" />
                {w}
              </span>
            ))}
            <span className="mt-1 block text-muted-foreground">
              Every class needs at least one box in the val split; the build refuses otherwise.
            </span>
          </div>
          {refusal ? (
            <>
              <p className="text-xs font-medium text-destructive">The version was refused. Nothing was created.</p>
              <HealthBlock health={refusal} />
            </>
          ) : null}
          <DialogFooter className="mt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !ratiosOk || !seedOk || eligible === 0} data-testid="version-submit">
              {submitting ? "Checking…" : "Build version"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// The SDK maps the API's own code onto `err.code` only for codes it knows;
// an unknown code like DATASET_VERSION_UNHEALTHY may arrive as BAD_REQUEST
// with the details intact, so the details decide.
function apiErrorStatusIs400WithHealth(err: unknown): boolean {
  const details = apiErrorDetails(err)
  return !!details && typeof details === "object" && "health" in details
}
