import { Link, useNavigate } from "@tanstack/react-router"
import { ArrowRightIcon, BoxesIcon, FlaskConicalIcon, PlayIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { DataTable, type DataTableColumn } from "@/components/data-table"
import { SectionCard } from "@/components/models/section-card"
import { StatusBadge } from "@/components/models/status-badge"
import { formatRelative } from "@/lib/relative-time"
import {
  formatDateTime,
  formatMetric,
  formatPercent,
  formatSeconds,
  JOB_STATUS_COLOR,
  JOB_STATUS_LABEL,
  jobPhase,
  jobTitle,
  jobWallSeconds,
  shortId,
} from "@/lib/models-format"
import {
  isActiveTrainingStatus,
  type DatasetVersion,
  type ModelEntry,
  type TrainingJob,
} from "@/lib/models-schemas"

// What came out of this dataset: the models it published (first, since that
// is what a user comes back for) and every training or assist job that read
// it, newest first. Jobs start from the Versions tab; this tab watches them.
export function TrainingTab({
  jobs,
  jobsLoading,
  models,
  versions,
  latestReady,
  canTrain,
  onTrain,
}: {
  jobs: TrainingJob[]
  jobsLoading: boolean
  models: ModelEntry[]
  versions: DatasetVersion[]
  latestReady: DatasetVersion | null
  canTrain: boolean
  onTrain: (version: DatasetVersion) => void
}) {
  const navigate = useNavigate()
  const versionNumber = (versionId: string | null | undefined): number | null =>
    versions.find((v) => v.id === versionId)?.version ?? null

  const columns: DataTableColumn<TrainingJob>[] = [
    {
      id: "job",
      header: "Job",
      cell: (job) => (
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-medium">{jobTitle(job)}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{shortId(job.id)}</span>
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (job) => {
        const phase = jobPhase(job)
        return (
          <span className="inline-flex items-center gap-1.5">
            <StatusBadge
              color={JOB_STATUS_COLOR[job.status]}
              label={JOB_STATUS_LABEL[job.status]}
              pulse={isActiveTrainingStatus(job.status)}
            />
            {phase ? <span className="text-[11px] text-muted-foreground">{phase}</span> : null}
          </span>
        )
      },
    },
    {
      id: "version",
      header: "Version",
      cellClassName: "tabular-nums",
      cell: (job) => {
        const n = versionNumber(job.datasetVersionId)
        return n !== null ? `v${n}` : job.task === "autolabel" ? <span className="text-muted-foreground">live items</span> : "—"
      },
    },
    {
      id: "setup",
      header: "Setup",
      cell: (job) => (
        <span className="text-xs">
          {job.task === "train" ? `${job.recipe}${job.mode ? ` · ${job.mode}` : ""}` : "assist"}
          <span className="ml-1 font-mono text-[11px] text-muted-foreground">
            {job.compute?.instanceType ?? job.target}
            {job.compute?.spot ? " spot" : ""}
          </span>
        </span>
      ),
    },
    {
      id: "map50",
      header: "mAP50",
      numeric: true,
      cell: (job) =>
        job.task === "train" && typeof job.metrics?.mAP50 === "number" ? (
          <span title={formatMetric(job.metrics.mAP50)}>{formatPercent(job.metrics.mAP50, 1)}</span>
        ) : (
          "—"
        ),
    },
    {
      id: "wall",
      header: "Wall / billable",
      numeric: true,
      cell: (job) => (
        <span className="text-xs">
          {formatSeconds(jobWallSeconds(job))}
          <span className="ml-1 text-muted-foreground">/ {formatSeconds(job.billableSeconds)}</span>
        </span>
      ),
    },
    {
      id: "createdAt",
      header: "Started",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (job) => <span title={formatDateTime(job.createdAt)}>{formatRelative(job.createdAt)} ago</span>,
    },
    {
      id: "open",
      header: "",
      align: "right",
      cell: (job) => (
        <Button variant="ghost" size="sm" asChild>
          <Link to="/training-jobs/$id" params={{ id: job.id }}>
            Open
            <ArrowRightIcon />
          </Link>
        </Button>
      ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto" data-testid="training-tab">
      <SectionCard
        title="Models from this dataset"
        description="Published into the organization registry by a succeeded training job. A workflow's detection node names them by name and version."
        testId="dataset-models"
      >
        {models.length === 0 ? (
          <p className="text-xs text-muted-foreground">No model yet. The first succeeded training job publishes one.</p>
        ) : (
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
            {models.map((m) => {
              const map50 = m.provenance?.metrics?.mAP50 ?? null
              return (
                <Link
                  key={m.id}
                  to="/models/$id"
                  params={{ id: m.id }}
                  className="group flex flex-col gap-2 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50"
                  data-testid="dataset-model-card"
                >
                  <span className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-md bg-muted text-foreground">
                      <BoxesIcon className="size-3.5" />
                    </span>
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate text-sm font-medium">
                        {m.name} <span className="font-mono text-xs text-muted-foreground">v{m.version}</span>
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {m.provenance?.trainedAt ? formatDateTime(m.provenance.trainedAt) : formatDateTime(m.createdAt)}
                      </span>
                    </span>
                    {m.status === "archived" ? (
                      <Badge variant="outline" className="ml-auto">
                        archived
                      </Badge>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span>
                      mAP50{" "}
                      <span className="font-medium text-foreground tabular-nums">
                        {typeof map50 === "number" ? formatPercent(map50, 1) : "—"}
                      </span>
                    </span>
                    <span>
                      <span className="font-medium text-foreground tabular-nums">{m.classNames.length}</span> class
                      {m.classNames.length === 1 ? "" : "es"}
                    </span>
                    {versionNumber(m.provenance?.datasetVersionId) !== null ? (
                      <span className="ml-auto">from v{versionNumber(m.provenance?.datasetVersionId)}</span>
                    ) : null}
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </SectionCard>

      <DataTable
        title="Jobs"
        columns={columns}
        rows={jobs}
        getRowKey={(job) => job.id}
        loading={jobsLoading}
        onRowClick={(job) => navigate({ to: "/training-jobs/$id", params: { id: job.id } })}
        action={
          canTrain && latestReady ? (
            <Button variant="outline" size="sm" onClick={() => onTrain(latestReady)} data-testid="training-tab-train">
              <PlayIcon />
              Train v{latestReady.version}
            </Button>
          ) : undefined
        }
        empty={
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FlaskConicalIcon />
              </EmptyMedia>
              <EmptyTitle>No training yet</EmptyTitle>
              <EmptyDescription>
                {latestReady
                  ? `Version ${latestReady.version} is ready. A job trains on it in the cloud and publishes a model here.`
                  : "Label the frames, build a version, then train on it. Jobs and their models show up here."}
              </EmptyDescription>
            </EmptyHeader>
            {canTrain && latestReady ? (
              <EmptyContent>
                <Button variant="brand" size="sm" onClick={() => onTrain(latestReady)}>
                  <PlayIcon />
                  Train v{latestReady.version}
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        }
      />
    </div>
  )
}
