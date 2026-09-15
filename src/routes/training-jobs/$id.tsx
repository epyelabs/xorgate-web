import { useEffect, useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { toast } from "sonner"
import {
  BoxesIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FlaskConicalIcon,
  ImagesIcon,
  SquareIcon,
  XCircleIcon,
} from "lucide-react"
import { isXorgateError } from "@xorgate/sdk"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StickyHeader } from "@/components/sticky-header"
import { formatBytes } from "@/components/data-table"
import { CopyButton } from "@/components/models/copy-button"
import { Fact, FactGrid } from "@/components/models/facts"
import { MetricTile } from "@/components/models/metric-tile"
import { SectionCard } from "@/components/models/section-card"
import { StatusBadge } from "@/components/models/status-badge"
import { cn } from "@/lib/utils"
import { xgMessage } from "@/lib/xorgate"
import { useHasPermission } from "@/lib/permissions"
import { cancelTrainingJob, getJobArtifactUrl, triggerDownload } from "@/lib/models-api"
import {
  formatCount,
  formatDateTime,
  formatMetric,
  formatSeconds,
  JOB_STATUS_COLOR,
  JOB_STATUS_LABEL,
  jobTitle,
  jobWallSeconds,
  shortId,
} from "@/lib/models-format"
import {
  confusionSchema,
  isActiveTrainingStatus,
  type ArtifactIndexEntry,
  type Confusion,
  type TrainingJobDetail,
} from "@/lib/models-schemas"
import { useDataset, useDatasetVersions, useInvalidateModels, useTrainingJob } from "@/queries/models"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import { TrainingCurve, type CurvePoint } from "./-components/training-curve"

const TABS = ["results", "logs", "artifacts"] as const
type Tab = (typeof TABS)[number]

export const Route = createFileRoute("/training-jobs/$id")({
  beforeLoad: requireAuth,
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
  }),
  component: TrainingJobDetailPage,
})

// Eval artifacts (confusion matrix, sample renders) live under the job's
// artifacts prefix; each is read through the presigned artifact-url route.
function useArtifactJson<T>(jobId: string, key: string | null, parse: (raw: unknown) => T | null) {
  const [state, setState] = useState<{ key: string; value: T | null } | null>(null)
  useEffect(() => {
    if (!key) return
    let cancelled = false
    ;(async () => {
      try {
        const url = await getJobArtifactUrl(jobId, key)
        const res = await fetch(url)
        const raw = (await res.json()) as unknown
        if (!cancelled) setState({ key, value: parse(raw) })
      } catch {
        if (!cancelled) setState({ key, value: null })
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, key])
  return key && state?.key === key ? state.value : null
}

function ConfusionMatrix({ confusion }: { confusion: Confusion }) {
  const max = Math.max(1, ...confusion.matrix.flat())
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="text-[11px]" data-testid="confusion-matrix">
          <thead>
            <tr>
              <th className="p-1 text-left font-normal text-muted-foreground">predicted \ true</th>
              {confusion.classes.map((c) => (
                <th key={c} className="p-1 text-center font-normal text-muted-foreground">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {confusion.matrix.map((row, i) => (
              <tr key={i}>
                <th className="p-1 text-left font-normal text-muted-foreground">{confusion.classes[i]}</th>
                {row.map((v, j) => (
                  <td
                    key={j}
                    className={cn("size-9 border border-border text-center tabular-nums", i === j ? "font-medium" : "")}
                    style={{ backgroundColor: `rgba(16, 185, 129, ${v === 0 ? 0 : 0.15 + 0.6 * (v / max)})` }}
                  >
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Rows are predictions, columns the ground truth, at confidence {confusion.confidence ?? "?"} and IoU {confusion.iou ?? "?"}.
        The last class is background: a box with no match. The diagonal is what the model got right.
      </p>
    </div>
  )
}

function EvalSample({ jobId, entry }: { jobId: string; entry: ArtifactIndexEntry }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    getJobArtifactUrl(jobId, entry.key).then(
      (u) => {
        if (!cancelled) setUrl(u)
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [jobId, entry.key])
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noopener"
      className="relative block aspect-video overflow-hidden rounded-md border border-border bg-muted"
      title={entry.name}
      data-testid="eval-sample"
    >
      {url ? <img src={url} alt={entry.name} className="block size-full object-cover" loading="lazy" /> : <Skeleton className="absolute inset-0 rounded-none" />}
      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[9px] text-white">{entry.name.replace("eval/samples/", "")}</span>
    </a>
  )
}

function progressText(job: TrainingJobDetail, phase: string | null, epoch: number | null, epochs: number | null): string {
  if (job.status === "queued") return "Waiting for the dispatcher"
  if (job.status === "dispatched") return "Provisioning the instance and pulling the image (about a minute, not billed)"
  if (phase === "train" && epoch !== null && epochs) return `Training: epoch ${epoch} of ${epochs}`
  if (phase === "export") return "Exporting the model"
  if (phase === "check") return "Checking the export against the engine's contract"
  if (phase === "evaluate" || phase === "eval") return "Evaluating on the validation split"
  return phase ? `Phase: ${phase}` : "Running"
}

function TrainingJobDetailPage() {
  const { id } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = useNavigate()
  const activeTab: Tab = tab ?? "results"
  const canTrain = useHasPermission("models:train")
  const invalidate = useInvalidateModels()
  const [cancelling, setCancelling] = useState(false)

  const jobQuery = useTrainingJob(id)
  const job: TrainingJobDetail | null = jobQuery.data ?? null
  const notFound = isXorgateError(jobQuery.error) && jobQuery.error.status === 404
  const error = job || !jobQuery.error || notFound ? null : xgMessage(jobQuery.error)

  // The dataset and version the job read, for the rail's names.
  const datasetQuery = useDataset(job?.datasetId ?? "", !!job?.datasetId)
  const versionsQuery = useDatasetVersions(job?.datasetId ?? "", !!job?.datasetId)

  useEffect(() => {
    if (error) toast.error(error)
  }, [error])
  useEffect(() => {
    if (job) useBreadcrumbStore.getState().setJobName(jobTitle(job))
  }, [job])
  useEffect(() => {
    return () => {
      useBreadcrumbStore.getState().setJobName(null)
    }
  }, [id])

  // The registry and the dataset counts change when a job closes.
  const status = job?.status
  useEffect(() => {
    if (status && !isActiveTrainingStatus(status)) {
      invalidate.registry()
      if (job?.datasetId) invalidate.dataset(job.datasetId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const artifactsPrefix = job?.artifacts?.prefix ?? null
  const confusionKey = artifactsPrefix && job?.artifacts?.eval?.confusion ? `${artifactsPrefix}${job.artifacts.eval.confusion}` : null
  const confusion = useArtifactJson(id, confusionKey, (raw) => {
    const p = confusionSchema.safeParse(raw)
    return p.success ? p.data : null
  })

  const setTab = (next: string) => {
    navigate({
      to: "/training-jobs/$id",
      params: { id },
      search: next === "results" ? {} : { tab: next as Tab },
      replace: true,
    })
  }

  const cancel = async () => {
    if (!job) return
    setCancelling(true)
    try {
      const res = await cancelTrainingJob(job.id)
      toast.success(res.stopping ? "Stop requested; the row closes when SageMaker confirms" : "Job cancelled")
      invalidate.jobs()
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setCancelling(false)
    }
  }

  const download = async (entry: ArtifactIndexEntry) => {
    try {
      triggerDownload(await getJobArtifactUrl(id, entry.key), entry.name.slice(entry.name.lastIndexOf("/") + 1))
    } catch (err) {
      toast.error(xgMessage(err))
    }
  }

  if (notFound) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <p className="text-sm text-muted-foreground">Training job not found.</p>
      </div>
    )
  }
  if (error && !job) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }
  if (!job) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4 pt-0">
        <Skeleton className="h-12 w-full max-w-2xl" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    )
  }

  const active = isActiveTrainingStatus(job.status)
  const isTrain = job.task === "train"
  const tail = job.progressTail ?? null
  const phase = tail?.phase ?? job.progress?.phase ?? null
  const epoch = tail?.epoch ?? job.metrics?.epochsCompleted ?? job.progress?.epochsCompleted ?? null
  const epochs = tail?.epochs ?? null
  const progressPct = epoch !== null && epochs ? Math.min(100, Math.round((epoch / epochs) * 100)) : null
  const wall = jobWallSeconds(job)
  const metrics = job.metrics
  const samples = job.artifactIndex.filter((a) => a.name.startsWith("eval/samples/"))
  const logLines = (tail?.lines ?? []).filter((l) => l.t === "log" || l.t === "epoch" || l.t === "status").slice(-60)
  const checkLines = job.artifacts?.check?.lines ?? []
  const curve: CurvePoint[] = (() => {
    const byEpoch = new Map<number, CurvePoint>()
    for (const l of tail?.lines ?? []) {
      if (l.t === "epoch" && typeof l.epoch === "number") {
        byEpoch.set(l.epoch, { epoch: l.epoch, mAP50: l.mAP50 ?? null, loss: l.loss ?? null })
      }
    }
    return [...byEpoch.values()].sort((a, b) => a.epoch - b.epoch)
  })()
  const dataset = datasetQuery.data ?? null
  const version = (versionsQuery.data ?? []).find((v) => v.id === job.datasetVersionId) ?? null
  const hasResults = Boolean((isTrain && metrics) || (!isTrain && metrics?.labels) || confusion || samples.length > 0 || curve.length > 1)

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0" data-testid="job-detail" data-status={job.status}>
      <StickyHeader className="border-b border-border pb-3">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight">{jobTitle(job)}</h1>
                <StatusBadge color={JOB_STATUS_COLOR[job.status]} label={JOB_STATUS_LABEL[job.status]} pulse={active} testId="job-status" />
                {active && phase && phase !== job.status ? <Badge variant="secondary">{phase}</Badge> : null}
                {job.output?.label ? <span className="text-sm text-muted-foreground">{job.output.label}</span> : null}
              </div>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-0.5" title={job.id}>
                  job {shortId(job.id)}
                  <CopyButton value={job.id} label="Copy job id" className="size-4" />
                </span>
                {job.externalRef ? (
                  <span className="inline-flex items-center gap-0.5 truncate" title={job.externalRef}>
                    · {job.externalRef}
                    <CopyButton value={job.externalRef} label="Copy SageMaker name" className="size-4" />
                  </span>
                ) : null}
              </p>
              {job.datasetId ? (
                <p className="text-xs text-muted-foreground" data-testid="job-lineage">
                  {isTrain ? "Trained on" : "Pre-labels"}{" "}
                  <Link to="/datasets/$id" params={{ id: job.datasetId }} search={{}} className="font-medium text-foreground underline-offset-2 hover:underline">
                    {dataset?.name ?? "the dataset"}
                  </Link>
                  {isTrain && version ? (
                    <>
                      {" "}
                      <Link to="/datasets/$id" params={{ id: job.datasetId }} search={{ tab: "versions" }} className="font-medium text-foreground underline-offset-2 hover:underline">
                        v{version.version}
                      </Link>
                      {version.stats ? ` (${version.stats.images.train} train / ${version.stats.images.val} val)` : ""}
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {job.outputModel ? (
                <Button variant="brand" size="lg" asChild>
                  <Link to="/models/$id" params={{ id: job.outputModel.id }} data-testid="open-published-model">
                    <BoxesIcon />
                    Open {job.outputModel.name} v{job.outputModel.version}
                  </Link>
                </Button>
              ) : null}
              {!isTrain && job.status === "succeeded" && job.datasetId ? (
                <Button variant="brand" size="lg" asChild>
                  <Link to="/datasets/$id" params={{ id: job.datasetId }} search={{}}>
                    <ImagesIcon />
                    Review pre-labels
                  </Link>
                </Button>
              ) : null}
              {canTrain && active ? (
                <Button
                  variant="destructive"
                  size="lg"
                  onClick={() => void cancel()}
                  disabled={cancelling || !!job.progress?.stopRequestedAt}
                  data-testid="cancel-job"
                >
                  <SquareIcon />
                  {job.progress?.stopRequestedAt ? "Stopping…" : "Cancel job"}
                </Button>
              ) : null}
            </div>
          </div>
        </header>
      </StickyHeader>

      {active ? (
        <SectionCard testId="job-progress" contentClassName="gap-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="inline-flex items-center gap-2 font-medium">
              <span className="size-2 animate-pulse rounded-full bg-sky-500" />
              {progressText(job, phase, epoch, epochs)}
            </span>
            {progressPct !== null ? <span className="font-mono text-xs tabular-nums">{progressPct}%</span> : null}
          </div>
          {progressPct !== null ? (
            <Progress value={progressPct} className="h-2 [&>[data-slot=progress-indicator]]:bg-sky-500" />
          ) : (
            <div className="h-2 w-full overflow-hidden rounded-md bg-muted">
              <div className="h-full w-1/4 animate-pulse rounded-md bg-sky-500" />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {tail?.lastEpochMap50 !== null && tail?.lastEpochMap50 !== undefined ? (
              <span>
                last epoch mAP50 <span className="font-mono text-foreground">{formatMetric(tail.lastEpochMap50)}</span>
              </span>
            ) : null}
            {job.compute?.maxMinutes !== undefined ? <span>budget {job.compute.maxMinutes} min</span> : null}
            <span>started {formatDateTime(job.startedAt ?? job.createdAt)}</span>
          </div>
          {tail?.lastLine ? <p className="truncate font-mono text-[11px] text-muted-foreground">{tail.lastLine}</p> : null}
          <p className="text-[10px] text-muted-foreground">
            Refreshes every 2.5 s. A finished container can read as running for up to 30 s while the terminal state arrives.
          </p>
        </SectionCard>
      ) : null}

      {job.status === "failed" ? (
        <Alert variant="destructive" data-testid="job-error">
          <XCircleIcon />
          <AlertTitle>The job failed{phase ? ` during ${phase}` : ""}</AlertTitle>
          <AlertDescription>
            {job.error ? <span className="font-mono">{job.error}</span> : "The recipe left no message."} Nothing was published
            {job.output?.version ? `; version ${job.output.version} of ${job.output.name} stays unused` : ""}. The log tail below
            has the last lines the container wrote.
          </AlertDescription>
          <AlertAction>
            <Button variant="outline" size="xs" onClick={() => setTab("logs")}>
              View logs
            </Button>
          </AlertAction>
        </Alert>
      ) : job.status === "cancelled" ? (
        <Alert className="border-amber-500/40 bg-amber-500/5" data-testid="job-cancelled">
          <SquareIcon className="text-amber-600" />
          <AlertTitle>Cancelled{job.error && job.error !== "Stopped" ? `: ${job.error}` : ""}</AlertTitle>
          <AlertDescription>
            Nothing was published{job.output?.version ? `; version ${job.output.version} of ${job.output.name} stays unused` : ""}.
            Billable time covers the container up to the stop.
          </AlertDescription>
        </Alert>
      ) : job.status === "succeeded" && job.outputModel ? (
        <Alert className="border-emerald-500/40 bg-emerald-500/5" data-testid="job-published">
          <CheckCircle2Icon className="text-emerald-600" />
          <AlertTitle>
            Published {job.outputModel.name} v{job.outputModel.version} to the registry
          </AlertTitle>
          <AlertDescription>
            A workflow's detection node can name it now
            {typeof metrics?.confidence === "number"
              ? `; the template picker prefills its min confidence to ${formatMetric(metrics.confidence, 2)}, the threshold these results were measured at`
              : ""}
            .
          </AlertDescription>
          <AlertAction>
            <Button variant="outline" size="xs" asChild>
              <Link to="/models/$id" params={{ id: job.outputModel.id }}>
                Open model
              </Link>
            </Button>
          </AlertAction>
        </Alert>
      ) : job.status === "succeeded" && !isTrain && metrics?.labels ? (
        <Alert className="border-emerald-500/40 bg-emerald-500/5" data-testid="job-published">
          <CheckCircle2Icon className="text-emerald-600" />
          <AlertTitle>
            Pre-labeled {formatCount(metrics.applied?.itemsLabeled ?? metrics.labels.images ?? 0)} items with{" "}
            {formatCount(metrics.applied?.boxes ?? metrics.labels.boxes ?? 0)} boxes
          </AlertTitle>
          <AlertDescription>
            They show dashed in the annotator until someone accepts or rejects them. Accepted boxes count as labeled.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs value={activeTab} onValueChange={setTab}>
            <TabsList variant="line">
              <TabsTrigger value="results" data-testid="tab-results">
                Results
              </TabsTrigger>
              <TabsTrigger value="logs" data-testid="tab-logs">
                Logs
              </TabsTrigger>
              <TabsTrigger value="artifacts" data-testid="tab-artifacts">
                Artifacts
                {job.artifactIndex.length > 0 ? (
                  <Badge variant="secondary" className="ml-1">
                    {job.artifactIndex.length}
                  </Badge>
                ) : null}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {activeTab === "results" ? (
            <div className="flex flex-col gap-4">
              {isTrain && metrics ? (
                <SectionCard
                  title="Evaluation"
                  description="Measured on the validation split after the final epoch. Higher is better; mAP50 is the headline number."
                  testId="job-metrics"
                >
                  <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(8.5rem,1fr))]">
                    <MetricTile label="mAP50" value={metrics.mAP50} />
                    <MetricTile label="mAP50-95" value={metrics.mAP50_95} />
                    <MetricTile label="Precision" value={metrics.precision} />
                    <MetricTile label="Recall" value={metrics.recall} />
                    <MetricTile
                      label="Operating confidence"
                      value={metrics.confidence}
                      format="raw"
                      digits={2}
                      valueTestId="job-operating-confidence"
                      hint={typeof metrics.confidence === "number" ? "F1-max threshold" : "Not measured (forge 0.1.0)"}
                    />
                    <MetricTile label="Epochs" value={metrics.epochsCompleted} format="raw" hint={epochs ? `of ${epochs} planned` : undefined} />
                  </div>
                  {typeof metrics.confidence === "number" ? (
                    <p className="text-[11px] text-muted-foreground">
                      Precision and recall are measured at the operating confidence, the threshold that maximizes F1 on the
                      validation split. Run the model at it: the template picker sets the detection node's min confidence to{" "}
                      {formatMetric(metrics.confidence, 2)} when you pick this model, and the gate downstream has its own threshold to
                      match.
                    </p>
                  ) : null}
                  {metrics.mAP50 === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      A zero here is a real measurement, not an error: a few epochs on a small set find nothing at any confidence.
                      The fast preset's 50 epochs is where this dataset starts to mean something.
                    </p>
                  ) : null}
                  {metrics.perClass && metrics.perClass.length > 0 ? (
                    <Table className="max-w-2xl" data-testid="per-class-table">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Class</TableHead>
                          <TableHead className="text-right">Instances</TableHead>
                          <TableHead className="text-right">mAP50</TableHead>
                          <TableHead className="text-right">mAP50-95</TableHead>
                          <TableHead className="text-right">Precision</TableHead>
                          <TableHead className="text-right">Recall</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {metrics.perClass.map((c) => (
                          <TableRow key={c.name}>
                            <TableCell className="font-medium">{c.name}</TableCell>
                            <TableCell className="text-right tabular-nums">{c.instances ?? "—"}</TableCell>
                            <TableCell className="text-right font-mono tabular-nums">{formatMetric(c.mAP50)}</TableCell>
                            <TableCell className="text-right font-mono tabular-nums">{formatMetric(c.mAP50_95)}</TableCell>
                            <TableCell className="text-right font-mono tabular-nums">{formatMetric(c.precision)}</TableCell>
                            <TableCell className="text-right font-mono tabular-nums">{formatMetric(c.recall)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : null}
                </SectionCard>
              ) : null}

              {curve.length > 1 ? (
                <SectionCard
                  title={active ? "Training curve (live)" : "Training curve"}
                  description="Validation mAP50 and training loss per epoch, from the progress log. Early stop triggers after a run of quiet epochs."
                >
                  <TrainingCurve points={curve} />
                </SectionCard>
              ) : null}

              {!isTrain && metrics?.labels ? (
                <SectionCard title="Labels written" description="What the assist model found, and how much of it landed on items as pre-labels." testId="job-labels">
                  <FactGrid>
                    <Fact label="Images labeled" value={metrics.labels.images ?? "—"} mono />
                    <Fact label="Boxes" value={metrics.labels.boxes ?? "—"} mono />
                    <Fact label="Items updated" value={metrics.applied?.itemsLabeled ?? "—"} mono />
                    <Fact
                      label="Per class"
                      value={
                        Object.entries(metrics.labels.perClass ?? {})
                          .map(([k, v]) => `${k} ${v}`)
                          .join(", ") || "—"
                      }
                      mono
                      span
                    />
                  </FactGrid>
                  {metrics.labels.unmapped && Object.keys(metrics.labels.unmapped).length > 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      Not written (no class map entry):{" "}
                      {Object.entries(metrics.labels.unmapped)
                        .map(([k, v]) => `${k} ${v}`)
                        .join(", ")}
                    </p>
                  ) : null}
                </SectionCard>
              ) : null}

              {confusion ? (
                <SectionCard title="Confusion matrix" testId="job-confusion">
                  <ConfusionMatrix confusion={confusion} />
                </SectionCard>
              ) : null}

              {samples.length > 0 ? (
                <SectionCard
                  title="Evaluation samples"
                  description="Predictions drawn against the ground truth on the val split, as the recipe rendered them. Click one to open it full size."
                  testId="job-samples"
                >
                  <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
                    {samples.map((s) => (
                      <EvalSample key={s.key} jobId={id} entry={s} />
                    ))}
                  </div>
                </SectionCard>
              ) : null}

              {!hasResults ? (
                <Empty className="py-12">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FlaskConicalIcon />
                    </EmptyMedia>
                    <EmptyTitle>{active ? "Results arrive when the job finishes" : "No results"}</EmptyTitle>
                    <EmptyDescription>
                      {active
                        ? "Metrics, the confusion matrix and the evaluation samples are written after the last epoch. The log tail updates while it runs."
                        : "The job ended before evaluation wrote anything. The logs may say why."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}
            </div>
          ) : activeTab === "logs" ? (
            <div className="flex flex-col gap-4">
              {logLines.length > 0 ? (
                <SectionCard
                  title={active ? "Log tail (live)" : "Log tail"}
                  description="The last lines of the container's progress log. Epoch lines carry the validation mAP50 and the loss."
                  testId="job-log"
                >
                  <pre className="max-h-[32rem] overflow-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px] whitespace-pre-wrap">
                    {logLines
                      .map((l) =>
                        l.t === "log"
                          ? l.line
                          : l.t === "epoch"
                            ? `epoch ${l.epoch}/${l.epochs}${l.mAP50 !== null && l.mAP50 !== undefined ? `  mAP50 ${l.mAP50.toFixed(4)}` : ""}${l.loss !== null && l.loss !== undefined ? `  loss ${l.loss.toFixed(4)}` : ""}`
                            : `[${l.status ?? ""}] ${l.phase ?? ""}`,
                      )
                      .join("\n")}
                  </pre>
                  {tail?.skipped ? <span className="text-[10px] text-muted-foreground">{tail.skipped} partial line(s) skipped in the tail</span> : null}
                </SectionCard>
              ) : null}
              {checkLines.length > 0 ? (
                <SectionCard
                  title="Export check"
                  description={`The same assertions the engine runs before it loads a model${job.artifacts?.check?.ok === false ? ". This one did not pass." : "."}`}
                  testId="job-check"
                >
                  <pre className="rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px] whitespace-pre-wrap">{checkLines.join("\n")}</pre>
                </SectionCard>
              ) : null}
              {logLines.length === 0 && checkLines.length === 0 ? (
                <Empty className="py-12">
                  <EmptyHeader>
                    <EmptyTitle>No log lines yet</EmptyTitle>
                    <EmptyDescription>
                      {job.status === "queued" || job.status === "dispatched"
                        ? "The container writes its first line once it starts."
                        : "This job left no progress log."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {job.artifactIndex.length > 0 ? (
                <SectionCard
                  title="Artifacts"
                  description="Everything the job wrote under its prefix: the exported model, weights, the evaluation and the logs. Links are presigned on click."
                  testId="job-artifacts"
                  contentClassName="px-0"
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-3">File</TableHead>
                        <TableHead className="text-right">Size</TableHead>
                        <TableHead className="w-24 pr-3" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {job.artifactIndex.map((a) => (
                        <TableRow key={a.key}>
                          <TableCell className="pl-3 font-mono text-[11px]">{a.name}</TableCell>
                          <TableCell className="text-right text-muted-foreground tabular-nums">{formatBytes(a.bytes)}</TableCell>
                          <TableCell className="pr-3 text-right">
                            <Button variant="ghost" size="xs" onClick={() => void download(a)}>
                              <DownloadIcon />
                              Download
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </SectionCard>
              ) : (
                <Empty className="py-12">
                  <EmptyHeader>
                    <EmptyTitle>No artifacts yet</EmptyTitle>
                    <EmptyDescription>
                      {active ? "The index fills in as the container uploads its output." : "This job wrote nothing under its prefix."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <SectionCard title="Job" testId="job-facts">
            <FactGrid columns={2}>
              <Fact label="Task" value={isTrain ? "Train" : "Assist"} />
              <Fact label="Recipe" value={`${job.recipe}${job.recipeLicense ? ` (${job.recipeLicense})` : ""}`} />
              {job.base ? <Fact label="Base weights" value={job.base.ref} mono /> : null}
              {job.mode ? <Fact label="Mode" value={job.mode} /> : null}
              <Fact label="Instance" value={`${job.compute?.instanceType ?? job.target}${job.compute?.spot ? " (spot)" : ""}`} mono />
              <Fact label="Budget" value={job.compute?.maxMinutes !== undefined ? `${job.compute.maxMinutes} min` : "—"} hint="bounds the container" />
            </FactGrid>
          </SectionCard>
          <SectionCard title="Timing">
            <FactGrid columns={2}>
              <Fact label="Wall time" value={wall !== null ? formatSeconds(wall) : active ? "running" : "—"} />
              <Fact label="Billable" value={formatSeconds(job.billableSeconds)} />
              <Fact label="Created" value={formatDateTime(job.createdAt)} span />
              <Fact label="Started" value={formatDateTime(job.startedAt)} span />
              <Fact label="Ended" value={formatDateTime(job.endedAt)} span />
            </FactGrid>
            {wall !== null && job.billableSeconds !== null ? (
              <p className="text-[11px] text-muted-foreground">
                Wall time counts provisioning, the image pull and the finalizer; billable time is the container
                {job.compute?.spot ? " after the spot discount" : ""}.
              </p>
            ) : null}
          </SectionCard>
          {metrics?.hyperparameters ? (
            <SectionCard title="Hyperparameters">
              <div className="flex flex-wrap gap-1">
                {Object.entries(metrics.hyperparameters).map(([k, v]) => (
                  <span key={k} className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]">
                    {k}={String(v)}
                  </span>
                ))}
              </div>
            </SectionCard>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
