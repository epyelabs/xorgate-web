import { useEffect, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { toast } from "sonner"
import { BoxesIcon, DownloadIcon, SquareIcon } from "lucide-react"
import { isXorgateError } from "@xorgate/sdk"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusDot } from "@/components/data-table"
import { StickyHeader } from "@/components/sticky-header"
import { cn } from "@/lib/utils"
import { xgMessage } from "@/lib/xorgate"
import { useHasPermission } from "@/lib/permissions"
import { cancelTrainingJob, getJobArtifactUrl, triggerDownload } from "@/lib/models-api"
import {
  formatDateTime,
  formatMetric,
  formatSeconds,
  JOB_STATUS_COLOR,
  jobTitle,
  jobWallSeconds,
} from "@/lib/models-format"
import {
  confusionSchema,
  isActiveTrainingStatus,
  type ArtifactIndexEntry,
  type Confusion,
  type TrainingJobDetail,
} from "@/lib/models-schemas"
import { useInvalidateModels, useTrainingJob } from "@/queries/models"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import { formatBytes } from "@/components/data-table"

export const Route = createFileRoute("/training-jobs/$id")({
  beforeLoad: requireAuth,
  component: TrainingJobDetailPage,
})

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h2 className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  )
}

function Fact({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] tracking-wider text-muted-foreground uppercase">{label}</span>
      <span className={cn("text-sm", mono ? "font-mono text-xs" : "")}>{value}</span>
    </div>
  )
}

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
      <p className="mt-1 text-[10px] text-muted-foreground">
        Rows are predictions, columns the ground truth, at confidence {confusion.confidence ?? "?"} and IoU {confusion.iou ?? "?"}.
        The last class is background: a box with no match.
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
      className="relative block aspect-video overflow-hidden rounded border border-border bg-muted"
      title={entry.name}
      data-testid="eval-sample"
    >
      {url ? <img src={url} alt={entry.name} className="block size-full object-cover" loading="lazy" /> : <Skeleton className="absolute inset-0 rounded-none" />}
      <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9px] text-white">{entry.name.replace("eval/samples/", "")}</span>
    </a>
  )
}

function TrainingJobDetailPage() {
  const { id } = Route.useParams()
  const canTrain = useHasPermission("models:train")
  const invalidate = useInvalidateModels()
  const [cancelling, setCancelling] = useState(false)

  const jobQuery = useTrainingJob(id)
  const job: TrainingJobDetail | null = jobQuery.data ?? null
  const notFound = isXorgateError(jobQuery.error) && jobQuery.error.status === 404
  const error = job || !jobQuery.error || notFound ? null : xgMessage(jobQuery.error)

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
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    )
  }

  const active = isActiveTrainingStatus(job.status)
  const tail = job.progressTail ?? null
  const phase = tail?.phase ?? job.progress?.phase ?? job.status
  const epoch = tail?.epoch ?? job.metrics?.epochsCompleted ?? job.progress?.epochsCompleted ?? null
  const epochs = tail?.epochs ?? null
  const progressPct = epoch !== null && epochs ? Math.min(100, Math.round((epoch / epochs) * 100)) : null
  const wall = jobWallSeconds(job)
  const metrics = job.metrics
  const samples = job.artifactIndex.filter((a) => a.name.startsWith("eval/samples/"))
  const logLines = (tail?.lines ?? []).filter((l) => l.t === "log" || l.t === "epoch" || l.t === "status").slice(-60)

  return (
    <div className="flex flex-1 flex-col gap-5 p-4 pt-0" data-testid="job-detail" data-status={job.status}>
      <StickyHeader className="border-b border-border pb-4">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{jobTitle(job)}</h1>
            <StatusDot color={JOB_STATUS_COLOR[job.status]} label={job.status} pulse={active} />
            {phase && phase !== job.status ? <Badge variant="outline">{phase}</Badge> : null}
            {job.output?.label ? <span className="text-sm text-muted-foreground">{job.output.label}</span> : null}
            <span className="ml-auto flex items-center gap-2">
              {job.outputModel ? (
                <Button variant="brand" size="sm" asChild>
                  <Link to="/models/$id" params={{ id: job.outputModel.id }} data-testid="open-published-model">
                    <BoxesIcon />
                    Open {job.outputModel.name} v{job.outputModel.version}
                  </Link>
                </Button>
              ) : null}
              {canTrain && active ? (
                <Button variant="destructive" size="sm" onClick={() => void cancel()} disabled={cancelling || !!job.progress?.stopRequestedAt} data-testid="cancel-job">
                  <SquareIcon />
                  {job.progress?.stopRequestedAt ? "Stopping…" : "Cancel"}
                </Button>
              ) : null}
            </span>
          </div>
          <p className="font-mono text-[11px] text-muted-foreground">
            {job.id}
            {job.externalRef ? ` · ${job.externalRef}` : ""}
          </p>
        </header>
      </StickyHeader>

      {active ? (
        <Section title="Progress" testId="job-progress">
          <div className="flex flex-col gap-1.5 rounded-md border border-border p-3">
            <div className="flex items-center justify-between text-xs">
              <span>
                {job.status === "queued"
                  ? "Waiting for the dispatcher"
                  : job.status === "dispatched"
                    ? "Provisioning the instance and pulling the image (about a minute, not billed)"
                    : phase === "train" && epoch !== null && epochs
                      ? `Epoch ${epoch} of ${epochs}`
                      : `Phase: ${phase}`}
              </span>
              {progressPct !== null ? <span className="tabular-nums">{progressPct}%</span> : null}
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div
                className={cn("h-full rounded bg-sky-500 transition-[width]", progressPct === null ? "animate-pulse w-1/4" : "")}
                style={progressPct !== null ? { width: `${progressPct}%` } : undefined}
              />
            </div>
            {tail?.lastEpochMap50 !== null && tail?.lastEpochMap50 !== undefined ? (
              <span className="text-[11px] text-muted-foreground">last epoch mAP50 {formatMetric(tail.lastEpochMap50)}</span>
            ) : null}
            {tail?.lastLine ? <span className="truncate font-mono text-[11px] text-muted-foreground">{tail.lastLine}</span> : null}
            <span className="text-[10px] text-muted-foreground">
              Polling every 2.5 s. A finished container can read as running for up to 30 s while the terminal state arrives.
            </span>
          </div>
        </Section>
      ) : null}

      {job.status === "failed" ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs" data-testid="job-error">
          <span className="font-medium">Failed</span>
          {job.error ? <span className="ml-2 font-mono">{job.error}</span> : <span className="ml-2">with no message from the recipe.</span>}
        </div>
      ) : job.status === "cancelled" ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs" data-testid="job-cancelled">
          Cancelled{job.error && job.error !== "Stopped" ? `: ${job.error}` : ""}. Nothing was published
          {job.output?.version ? `; version ${job.output.version} of the name stays unused` : ""}.
        </div>
      ) : null}

      <Section title="Job" testId="job-facts">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <Fact label="Task" value={job.task} />
          <Fact label="Recipe" value={`${job.recipe}${job.recipeLicense ? ` (${job.recipeLicense})` : ""}`} />
          {job.base ? <Fact label="Base" value={job.base.ref} mono /> : null}
          {job.mode ? <Fact label="Mode" value={job.mode} /> : null}
          <Fact label="Instance" value={`${job.compute?.instanceType ?? job.target}${job.compute?.spot ? " (spot)" : ""}`} mono />
          <Fact label="Budget" value={job.compute?.maxMinutes !== undefined ? `${job.compute.maxMinutes} min container` : "—"} />
          <Fact label="Wall time" value={wall !== null ? formatSeconds(wall) : active ? "running" : "—"} />
          <Fact label="Billable" value={formatSeconds(job.billableSeconds)} />
          <Fact label="Created" value={formatDateTime(job.createdAt)} />
          <Fact label="Started" value={formatDateTime(job.startedAt)} />
          <Fact label="Ended" value={formatDateTime(job.endedAt)} />
          <Fact
            label="Dataset"
            value={
              job.datasetId ? (
                <Link to="/datasets/$id" params={{ id: job.datasetId }} search={{ tab: "versions" }} className="text-primary underline-offset-2 hover:underline">
                  open dataset
                </Link>
              ) : (
                "—"
              )
            }
          />
        </div>
        {wall !== null && job.billableSeconds !== null ? (
          <p className="text-[11px] text-muted-foreground">
            Wall time counts provisioning, the image pull and the finalizer; billable time is the container
            {job.compute?.spot ? " after the spot discount" : ""}. Both are real.
          </p>
        ) : null}
      </Section>

      {job.task === "train" && metrics ? (
        <Section title="Metrics" testId="job-metrics">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Fact label="mAP50" value={formatMetric(metrics.mAP50)} mono />
            <Fact label="mAP50-95" value={formatMetric(metrics.mAP50_95)} mono />
            <Fact label="Precision" value={formatMetric(metrics.precision)} mono />
            <Fact label="Recall" value={formatMetric(metrics.recall)} mono />
            <Fact label="Epochs" value={metrics.epochsCompleted ?? "—"} mono />
          </div>
          {metrics.mAP50 === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              A zero here is a real measurement, not an error: a few epochs on a small set find nothing at any confidence.
              The fast preset's 50 epochs is where this dataset starts to mean something.
            </p>
          ) : null}
          {metrics.perClass && metrics.perClass.length > 0 ? (
            <table className="w-full max-w-xl text-xs" data-testid="per-class-table">
              <thead>
                <tr className="text-[10px] tracking-wider text-muted-foreground uppercase">
                  <th className="py-1 text-left font-normal">Class</th>
                  <th className="py-1 text-right font-normal">Instances</th>
                  <th className="py-1 text-right font-normal">mAP50</th>
                  <th className="py-1 text-right font-normal">mAP50-95</th>
                  <th className="py-1 text-right font-normal">Precision</th>
                  <th className="py-1 text-right font-normal">Recall</th>
                </tr>
              </thead>
              <tbody>
                {metrics.perClass.map((c) => (
                  <tr key={c.name} className="border-t border-border">
                    <td className="py-1">{c.name}</td>
                    <td className="py-1 text-right tabular-nums">{c.instances ?? "—"}</td>
                    <td className="py-1 text-right font-mono tabular-nums">{formatMetric(c.mAP50)}</td>
                    <td className="py-1 text-right font-mono tabular-nums">{formatMetric(c.mAP50_95)}</td>
                    <td className="py-1 text-right font-mono tabular-nums">{formatMetric(c.precision)}</td>
                    <td className="py-1 text-right font-mono tabular-nums">{formatMetric(c.recall)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {metrics.hyperparameters ? (
            <p className="font-mono text-[11px] text-muted-foreground">
              {Object.entries(metrics.hyperparameters)
                .map(([k, v]) => `${k}=${String(v)}`)
                .join("  ")}
            </p>
          ) : null}
        </Section>
      ) : null}

      {job.task === "autolabel" && metrics?.labels ? (
        <Section title="Labels" testId="job-labels">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Fact label="Images labeled" value={metrics.labels.images ?? "—"} mono />
            <Fact label="Boxes" value={metrics.labels.boxes ?? "—"} mono />
            <Fact label="Items updated" value={metrics.applied?.itemsLabeled ?? "—"} mono />
            <Fact
              label="Per class"
              value={Object.entries(metrics.labels.perClass ?? {})
                .map(([k, v]) => `${k} ${v}`)
                .join(", ") || "—"}
              mono
            />
          </div>
          {metrics.labels.unmapped && Object.keys(metrics.labels.unmapped).length > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              Not written (no class map entry):{" "}
              {Object.entries(metrics.labels.unmapped)
                .map(([k, v]) => `${k} ${v}`)
                .join(", ")}
            </p>
          ) : null}
        </Section>
      ) : null}

      {confusion ? (
        <Section title="Confusion matrix" testId="job-confusion">
          <ConfusionMatrix confusion={confusion} />
        </Section>
      ) : null}

      {samples.length > 0 ? (
        <Section title="Evaluation samples" testId="job-samples">
          <p className="text-[11px] text-muted-foreground">Predictions drawn against the ground truth on the val split, as the recipe rendered them.</p>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {samples.map((s) => (
              <EvalSample key={s.key} jobId={id} entry={s} />
            ))}
          </div>
        </Section>
      ) : null}

      {job.artifacts?.check?.lines?.length ? (
        <Section title="Check" testId="job-check">
          <pre className="rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px] whitespace-pre-wrap">{job.artifacts.check.lines.join("\n")}</pre>
        </Section>
      ) : null}

      {logLines.length > 0 ? (
        <Section title={active ? "Log tail (live)" : "Log tail"} testId="job-log">
          <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px] whitespace-pre-wrap">
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
        </Section>
      ) : null}

      {job.artifactIndex.length > 0 ? (
        <Section title="Artifacts" testId="job-artifacts">
          <ul className="flex flex-col gap-0.5">
            {job.artifactIndex.map((a) => (
              <li key={a.key} className="flex items-center gap-2 text-xs">
                <button type="button" onClick={() => void download(a)} className="inline-flex items-center gap-1 font-mono text-[11px] text-primary underline-offset-2 hover:underline">
                  <DownloadIcon className="size-3" />
                  {a.name}
                </button>
                <span className="text-[11px] text-muted-foreground tabular-nums">{formatBytes(a.bytes)}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  )
}
