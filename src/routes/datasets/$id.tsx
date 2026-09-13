import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { toast } from "sonner"
import {
  FilmIcon,
  LayersIcon,
  MoreHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
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
import { StatusDot } from "@/components/data-table"
import { xgMessage } from "@/lib/xorgate"
import { useHasPermission } from "@/lib/permissions"
import { ITEM_STATUS_COLOR, ITEM_STATUS_LABEL } from "@/lib/models-format"
import { ITEM_STATUSES, type ItemStatus } from "@/lib/models-schemas"
import { useDataset } from "@/queries/models"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import { AssistDialog } from "./-components/assist-dialog"
import { ClassesTab } from "./-components/classes-tab"
import { DeleteDatasetDialog } from "./-components/delete-dataset-dialog"
import { ImportRecordingDialog } from "./-components/import-recording-dialog"
import { ItemsTab } from "./-components/items-tab"
import { NewVersionDialog } from "./-components/new-version-dialog"
import { VersionsTab } from "./-components/versions-tab"

const TABS = ["items", "classes", "versions"] as const
type Tab = (typeof TABS)[number]

export const Route = createFileRoute("/datasets/$id")({
  beforeLoad: requireAuth,
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
  }),
  component: DatasetDetailPage,
})

// The dataset page: Items (the grid and the ways frames get in), Classes (the
// ordered list the hotkeys follow) and Versions (the frozen snapshots a job
// trains on). The tab rides in the URL so a link lands on the right one.
function DatasetDetailPage() {
  const { id } = Route.useParams()
  const { tab } = Route.useSearch()
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

  const datasetQuery = useDataset(id)
  const dataset = datasetQuery.data ?? null
  const notFound = isXorgateError(datasetQuery.error) && datasetQuery.error.status === 404
  const error = dataset || !datasetQuery.error || notFound ? null : xgMessage(datasetQuery.error)

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
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-80 w-full" />
      </div>
    )
  }

  const counts = dataset.itemsByStatus

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-0 min-w-0 flex-col gap-4 p-4 pt-0 group-has-data-[collapsible=icon]/sidebar-wrapper:h-[calc(100svh-3rem)]">
      <StickyHeader className="border-b border-border pb-3">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="truncate text-2xl font-semibold tracking-tight" data-testid="dataset-title">
                {dataset.name}
              </h1>
              <p className="text-sm text-muted-foreground">
                {dataset.description ?? "No description."}{" "}
                <span className="font-mono text-xs">{dataset.slug}</span>
              </p>
              <div className="flex flex-wrap items-center gap-3 text-xs" data-testid="dataset-counts">
                <span>
                  <span className="font-medium">{dataset.itemCount}</span> items
                </span>
                {ITEM_STATUSES.map((s) =>
                  counts[s] ? (
                    <StatusDot
                      key={s}
                      color={ITEM_STATUS_COLOR[s as ItemStatus]}
                      label={`${counts[s]} ${ITEM_STATUS_LABEL[s as ItemStatus]}`}
                    />
                  ) : null,
                )}
                <span className="text-muted-foreground">
                  {dataset.classes.length} class{dataset.classes.length === 1 ? "" : "es"}
                  {dataset.latestVersion !== null ? ` · v${dataset.latestVersion} ready` : ""}
                </span>
              </div>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {canAnnotate ? (
                <>
                  <Button variant="outline" size="lg" onClick={() => setImportOpen(true)} data-testid="add-from-recording">
                    <FilmIcon />
                    Add from recording
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => {
                      setTab("items")
                      setUploadOpen((n) => n + 1)
                    }}
                    data-testid="upload-frames"
                  >
                    <UploadIcon />
                    Upload
                  </Button>
                </>
              ) : null}
              {canTrain ? (
                <Button variant="outline" size="lg" onClick={() => setAssistOpen(true)} data-testid="assist-open">
                  <SparklesIcon />
                  Assist
                </Button>
              ) : null}
              {canAnnotate ? (
                <Button variant="brand" size="lg" onClick={() => setVersionOpen(true)} data-testid="new-version">
                  <LayersIcon />
                  New version
                </Button>
              ) : null}
              {canManage ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon-lg" aria-label="More">
                      <MoreHorizontalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setDeleteOpen(true)}
                    >
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
            </TabsList>
          </Tabs>
        </header>
      </StickyHeader>

      {activeTab === "items" ? (
        <ItemsTab dataset={dataset} openUploadSignal={uploadOpen} canAnnotate={canAnnotate} />
      ) : activeTab === "classes" ? (
        <ClassesTab dataset={dataset} canEdit={canAnnotate} />
      ) : (
        <VersionsTab dataset={dataset} canTrain={canTrain} onNewVersion={() => setVersionOpen(true)} />
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
      <DeleteDatasetDialog dataset={dataset} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </div>
  )
}
