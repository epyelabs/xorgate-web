import { useEffect, useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { toast } from "sonner"
import {
  ChevronDownIcon,
  FilmIcon,
  FlaskConicalIcon,
  LayersIcon,
  MoreHorizontalIcon,
  PencilLineIcon,
  PlayIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
  WorkflowIcon,
} from "lucide-react"
import { isXorgateError } from "@xorgate/sdk"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { StickyHeader } from "@/components/sticky-header"
import { CopyButton } from "@/components/models/copy-button"
import { LabelProgress } from "@/components/models/label-progress"
import { xgMessage } from "@/lib/xorgate"
import { useHasPermission } from "@/lib/permissions"
import { formatCount } from "@/lib/models-format"
import { isActiveTrainingStatus, type DatasetVersion, type ItemStatus } from "@/lib/models-schemas"
import {
  useDataset,
  useDatasetItems,
  useDatasetVersions,
  useRegistryModels,
  useTrainingJobs,
} from "@/queries/models"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import { TrainDialog } from "@/routes/training-jobs/-components/train-dialog"
import { AssistDialog } from "./-components/assist-dialog"
import { ClassesTab } from "./-components/classes-tab"
import { DeleteDatasetDialog } from "./-components/delete-dataset-dialog"
import { ImportRecordingDialog } from "./-components/import-recording-dialog"
import { ItemsTab, type ItemFilter } from "./-components/items-tab"
import { NewVersionDialog } from "./-components/new-version-dialog"
import { TrainingTab } from "./-components/training-tab"
import { VersionsTab } from "./-components/versions-tab"

const TABS = ["items", "classes", "versions", "training"] as const
type Tab = (typeof TABS)[number]

export const Route = createFileRoute("/datasets/$id")({
  beforeLoad: requireAuth,
  validateSearch: (search: Record<string, unknown>): { tab?: Tab; item?: string } => ({
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
    // The item open in the annotator pane; in the URL so a refresh or the
    // browser's back button behave.
    item: typeof search.item === "string" && search.item !== "" ? search.item : undefined,
  }),
  component: DatasetDetailPage,
})

// The one thing the page recommends next, derived from where the dataset
// sits in the lifecycle. It becomes the single brand button in the header;
// every other action stays reachable but quiet.
type NextStep =
  | { kind: "upload" }
  | { kind: "label"; status: ItemStatus; count: number; itemId: string | null }
  | { kind: "version" }
  | { kind: "watch"; jobId: string }
  | { kind: "train"; version: DatasetVersion }
  | { kind: "use"; modelId: string }

// The dataset page: Items (the grid and the ways frames get in), Classes (the
// ordered list the hotkeys follow), Versions (the frozen snapshots a job
// trains on) and Training (the jobs and models that came out of this
// dataset). The tab rides in the URL so a link lands on the right one.
function DatasetDetailPage() {
  const { id } = Route.useParams()
  const { tab, item: openItemId } = Route.useSearch()
  const navigate = useNavigate()
  const activeTab: Tab = tab ?? "items"
  const canAnnotate = useHasPermission("models:annotate")
  const canTrain = useHasPermission("models:train")
  const canManage = useHasPermission("models:manage")

  const [uploadOpen, setUploadOpen] = useState(0)
  const [importOpen, setImportOpen] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const [versionOpen, setVersionOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [trainVersion, setTrainVersion] = useState<DatasetVersion | null>(null)
  const [itemFilter, setItemFilter] = useState<ItemFilter>({})

  const datasetQuery = useDataset(id)
  const dataset = datasetQuery.data ?? null
  const notFound = isXorgateError(datasetQuery.error) && datasetQuery.error.status === 404
  const error = dataset || !datasetQuery.error || notFound ? null : xgMessage(datasetQuery.error)

  // The rest of the lifecycle, so the rail and the next step can name it.
  const versionsQuery = useDatasetVersions(id, dataset !== null)
  const jobsQuery = useTrainingJobs({ datasetId: id, limit: 50, sort: "createdAt", order: "desc" })
  const modelsQuery = useRegistryModels({ scope: "organization" })

  const counts = dataset?.itemsByStatus ?? {}
  const labelStatus: ItemStatus | null =
    (counts.unlabeled ?? 0) > 0 ? "unlabeled" : (counts.ai_labeled ?? 0) > 0 ? "ai_labeled" : null
  // The first item still needing a decision, for "Start labeling".
  const firstQuery = useDatasetItems(
    id,
    { status: labelStatus ?? undefined, limit: 1, order: "asc" },
    dataset !== null && labelStatus !== null,
  )

  useEffect(() => {
    if (error) toast.error(error)
  }, [error])

  useEffect(() => {
    if (dataset) useBreadcrumbStore.getState().setDatasetName(dataset.name)
  }, [dataset])
  useEffect(() => {
    return () => {
      useBreadcrumbStore.getState().setDatasetName(null)
    }
  }, [id])

  const setTab = (next: string) => {
    navigate({
      to: "/datasets/$id",
      params: { id },
      search: next === "items" ? {} : { tab: next as Tab },
      replace: true,
    })
  }
  const showItem = (itemId: string, replace = false) =>
    navigate({ to: "/datasets/$id", params: { id }, search: { item: itemId }, replace })

  if (notFound) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <p className="text-sm text-muted-foreground">Dataset not found.</p>
      </div>
    )
  }
  if (error && !dataset) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }
  if (!dataset) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4 pt-0">
        <Skeleton className="h-12 w-full max-w-2xl" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-80 w-full" />
      </div>
    )
  }

  const versions = versionsQuery.data ?? []
  const latestReady = versions.filter((v) => v.status === "ready").sort((a, b) => b.version - a.version)[0] ?? null
  const jobs = jobsQuery.data?.jobs ?? []
  const activeJob = jobs.find((j) => isActiveTrainingStatus(j.status)) ?? null
  const models = (modelsQuery.data?.models ?? [])
    .filter((m) => m.provenance?.datasetId === id)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
  const latestModel = models[0] ?? null

  const pending = (counts.unlabeled ?? 0) + (counts.ai_labeled ?? 0)
  const firstItemId = firstQuery.data?.items[0]?.id ?? null

  const next: NextStep =
    dataset.itemCount === 0
      ? { kind: "upload" }
      : labelStatus !== null
        ? { kind: "label", status: labelStatus, count: pending, itemId: firstItemId }
        : activeJob
          ? { kind: "watch", jobId: activeJob.id }
          : !latestReady
            ? { kind: "version" }
            : latestModel && latestModel.provenance?.datasetVersionId === latestReady.id
              ? { kind: "use", modelId: latestModel.id }
              : { kind: "train", version: latestReady }

  const nextButton = (() => {
    switch (next.kind) {
      case "upload":
        return canAnnotate ? (
          <Button
            variant="brand"
            size="lg"
            onClick={() => {
              setTab("items")
              setUploadOpen((n) => n + 1)
            }}
            data-testid="next-step"
            data-next="upload"
          >
            <UploadIcon />
            Upload frames
          </Button>
        ) : null
      case "label":
        return canAnnotate ? (
          <Button variant="brand" size="lg" asChild data-testid="next-step" data-next="label">
            {next.itemId ? (
              <Link to="/datasets/$id" params={{ id }} search={{ item: next.itemId }} onClick={() => setItemFilter({ status: next.status })}>
                <PencilLineIcon />
                {next.status === "ai_labeled" ? "Review" : "Label"} {formatCount(next.count)} item{next.count === 1 ? "" : "s"}
              </Link>
            ) : (
              <span aria-busy>
                <PencilLineIcon />
                Label {formatCount(next.count)} item{next.count === 1 ? "" : "s"}
              </span>
            )}
          </Button>
        ) : null
      case "version":
        return canAnnotate ? (
          <Button variant="brand" size="lg" onClick={() => setVersionOpen(true)} data-testid="new-version" data-next="version">
            <LayersIcon />
            Build a version
          </Button>
        ) : null
      case "watch":
        return (
          <Button variant="brand" size="lg" asChild data-testid="next-step" data-next="watch">
            <Link to="/training-jobs/$id" params={{ id: next.jobId }}>
              <FlaskConicalIcon />
              Watch training
            </Link>
          </Button>
        )
      case "train":
        return canTrain ? (
          <Button variant="brand" size="lg" onClick={() => setTrainVersion(next.version)} data-testid="next-step" data-next="train">
            <PlayIcon />
            Train v{next.version.version}
          </Button>
        ) : null
      case "use":
        return (
          <Button variant="brand" size="lg" asChild data-testid="next-step" data-next="use">
            <Link to="/models/$id" params={{ id: next.modelId }}>
              <WorkflowIcon />
              Use the model
            </Link>
          </Button>
        )
    }
  })()

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-0 min-w-0 flex-col gap-4 p-4 pt-0 group-has-data-[collapsible=icon]/sidebar-wrapper:h-[calc(100svh-3rem)]">
      <StickyHeader className="border-b border-border pb-3">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight" data-testid="dataset-title">
                  {dataset.name}
                </h1>
                <Badge variant="outline" className="font-mono font-normal">
                  {dataset.slug}
                  <CopyButton value={dataset.slug} label="Copy slug" className="-mr-1 size-4" />
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{dataset.description ?? "No description."}</p>
              <LabelProgress
                counts={counts}
                total={dataset.itemCount}
                className="max-w-2xl"
                testId="dataset-counts"
              />
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {canAnnotate ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="lg" data-testid="add-frames">
                      <PlusIcon />
                      Add frames
                      <ChevronDownIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => {
                        setTab("items")
                        setUploadOpen((n) => n + 1)
                      }}
                      data-testid="upload-frames"
                    >
                      <UploadIcon />
                      Upload images
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setImportOpen(true)} data-testid="add-from-recording">
                      <FilmIcon />
                      From a device recording
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {canTrain ? (
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setAssistOpen(true)}
                  data-testid="assist-open"
                  title="Let a registry model pre-label the unlabeled items"
                >
                  <SparklesIcon />
                  Assist
                </Button>
              ) : null}
              {canAnnotate && next.kind !== "version" ? (
                <Button variant="outline" size="lg" onClick={() => setVersionOpen(true)} data-testid="new-version">
                  <LayersIcon />
                  New version
                </Button>
              ) : null}
              {nextButton}
              {canManage ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon-lg" aria-label="More">
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                      <Trash2Icon />
                      Delete dataset
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </div>


          <Tabs value={activeTab} onValueChange={setTab}>
            <TabsList variant="line">
              <TabsTrigger value="items" data-testid="tab-items">
                Items
                <Badge variant="secondary" className="ml-1">
                  {dataset.itemCount}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="classes" data-testid="tab-classes">
                Classes
                <Badge variant="secondary" className="ml-1">
                  {dataset.classes.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="versions" data-testid="tab-versions">
                Versions
                <Badge variant="secondary" className="ml-1">
                  {dataset.versionCount}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="training" data-testid="tab-training">
                Training
                {jobs.length > 0 ? (
                  <Badge variant="secondary" className="ml-1">
                    {jobs.length}
                  </Badge>
                ) : null}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </header>
      </StickyHeader>

      {activeTab === "items" ? (
        <ItemsTab
          dataset={dataset}
          openUploadSignal={uploadOpen}
          canAnnotate={canAnnotate}
          onUpload={() => setUploadOpen((n) => n + 1)}
          onImport={() => setImportOpen(true)}
          filter={itemFilter}
          onFilterChange={setItemFilter}
          selectedItemId={openItemId ?? null}
          onSelectItem={(itemId, replace) => void showItem(itemId, replace)}
        />
      ) : activeTab === "classes" ? (
        <ClassesTab dataset={dataset} canEdit={canAnnotate} />
      ) : activeTab === "versions" ? (
        <VersionsTab
          dataset={dataset}
          canTrain={canTrain}
          canAnnotate={canAnnotate}
          onNewVersion={() => setVersionOpen(true)}
          onTrain={setTrainVersion}
        />
      ) : (
        <TrainingTab
          jobs={jobs}
          jobsLoading={jobsQuery.isPending}
          models={models}
          versions={versions}
          latestReady={latestReady}
          canTrain={canTrain}
          onTrain={setTrainVersion}
        />
      )}

      <ImportRecordingDialog dataset={dataset} open={importOpen} onOpenChange={setImportOpen} />
      <AssistDialog dataset={dataset} open={assistOpen} onOpenChange={setAssistOpen} />
      <NewVersionDialog
        dataset={dataset}
        open={versionOpen}
        onOpenChange={(open) => {
          setVersionOpen(open)
          if (!open && versionOpen) setTab("versions")
        }}
      />
      <TrainDialog
        datasetName={dataset.name}
        version={trainVersion}
        open={trainVersion !== null}
        onOpenChange={(open) => {
          if (!open) setTrainVersion(null)
        }}
      />
      <DeleteDatasetDialog dataset={dataset} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </div>
  )
}
