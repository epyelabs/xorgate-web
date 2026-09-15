import { useEffect, useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { toast } from "sonner"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronDownIcon,
  DownloadIcon,
  InfoIcon,
  Trash2Icon,
  WorkflowIcon,
} from "lucide-react"
import { isXorgateError } from "@xorgate/sdk"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DestroyDialog } from "@/components/destroy-dialog"
import { JsonTree } from "@/components/json-tree"
import { StickyHeader } from "@/components/sticky-header"
import { CopyButton } from "@/components/models/copy-button"
import { Fact, FactGrid } from "@/components/models/facts"
import { MetricTile } from "@/components/models/metric-tile"
import { SectionCard } from "@/components/models/section-card"
import { cn } from "@/lib/utils"
import { xgMessage } from "@/lib/xorgate"
import { useHasPermission } from "@/lib/permissions"
import { deleteModel, getModelDownload, patchModel, triggerDownload } from "@/lib/models-api"
import { formatDateTime, formatMetric, shortId } from "@/lib/models-format"
import { modelRef, operatingConfidence, type ModelDetail } from "@/lib/models-schemas"
import { useInvalidateModels, useRegistryModel } from "@/queries/models"
import { useBreadcrumbStore } from "@/store/breadcrumb"

const TABS = ["overview", "manifest"] as const
type Tab = (typeof TABS)[number]

export const Route = createFileRoute("/models/$id")({
  beforeLoad: requireAuth,
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
  }),
  component: RegistryModelPage,
})

// One registry entry: scope, the manifest as published (byte for byte, with
// the forge's provenance), lineage back to the dataset version and job,
// sibling versions, usage by published templates, download, archive. Delete
// is refused by the backend while a published template names the model; the
// usage list here is the same query, so the button says so first.
function RegistryModelPage() {
  const { id } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = useNavigate()
  const activeTab: Tab = tab ?? "overview"
  const canManage = useHasPermission("models:manage")
  const canDownload = useHasPermission("models:annotate")
  const invalidate = useInvalidateModels()
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const modelQuery = useRegistryModel(id)
  const model: ModelDetail | null = modelQuery.data ?? null
  const notFound = isXorgateError(modelQuery.error) && modelQuery.error.status === 404
  const error = model || !modelQuery.error || notFound ? null : xgMessage(modelQuery.error)

  useEffect(() => {
    if (error) toast.error(error)
  }, [error])
  useEffect(() => {
    if (model) useBreadcrumbStore.getState().setModelName(`${model.name} v${model.version}`)
  }, [model])
  useEffect(() => {
    return () => {
      useBreadcrumbStore.getState().setModelName(null)
    }
  }, [id])

  const setTab = (next: string) => {
    navigate({
      to: "/models/$id",
      params: { id },
      search: next === "overview" ? {} : { tab: next as Tab },
      replace: true,
    })
  }

  const download = async (file: "manifest.json" | "model.onnx") => {
    if (!model) return
    setBusy(true)
    try {
      const res = await getModelDownload(model.id)
      const url = res.files[file]
      if (!url) throw new Error(`${file} is not available`)
      triggerDownload(url, file)
      if (file === "model.onnx") {
        toast.message("Downloading model.onnx", {
          description: `Place it with manifest.json under <models-dir>/${res.localPath}/ for xwe run --models-dir.`,
        })
      }
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleArchive = async () => {
    if (!model) return
    setBusy(true)
    try {
      await patchModel(model.id, { status: model.status === "archived" ? "ready" : "archived" })
      toast.success(model.status === "archived" ? "Model restored" : "Model archived")
      invalidate.registry()
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (notFound) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <p className="text-sm text-muted-foreground">Model not found.</p>
      </div>
    )
  }
  if (error && !model) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }
  if (!model) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4 pt-0">
        <Skeleton className="h-12 w-full max-w-2xl" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    )
  }

  const isOrg = model.scope === "organization"
  const prov = model.provenance
  const metrics = prov?.metrics ?? null
  const input = model.manifest.input
  const inUse = model.usage.length > 0
  const ref = modelRef(model.name, model.version)
  const confidence = operatingConfidence(model)
  const jobId = model.lineage?.jobId ?? prov?.jobId ?? null

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0" data-testid="model-detail" data-scope={model.scope}>
      <StickyHeader className="border-b border-border pb-3">
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight">
                  {model.name} <span className="font-mono text-lg text-muted-foreground">v{model.version}</span>
                </h1>
                <Badge variant={isOrg ? "default" : "outline"}>{isOrg ? "Your organization" : "Platform"}</Badge>
                <Badge variant="outline">{model.family}</Badge>
                {model.status === "archived" ? <Badge variant="destructive">archived</Badge> : null}
              </div>
              <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                {model.label && model.label !== model.name ? <span>{model.label}</span> : null}
                <span className="inline-flex items-center gap-0.5">
                  <span className="text-xs">Named in a workflow as</span>
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">{ref}</code>
                  <CopyButton value={ref} label="Copy model reference" />
                </span>
                {model.lineage ? (
                  <span className="text-xs">
                    · trained on{" "}
                    <Link to="/datasets/$id" params={{ id: model.lineage.datasetId }} search={{ tab: "versions" }} className="font-medium text-foreground underline-offset-2 hover:underline">
                      {model.lineage.datasetName} v{model.lineage.datasetVersion}
                    </Link>
                  </span>
                ) : null}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {canDownload ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="lg" disabled={busy} data-testid="download-model">
                      <DownloadIcon />
                      Download
                      <ChevronDownIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                      The two files an engine loads
                    </DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => void download("manifest.json")} data-testid="download-manifest">
                      manifest.json
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void download("model.onnx")} data-testid="download-onnx">
                      model.onnx
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {canManage && isOrg ? (
                <>
                  <Button variant="outline" size="lg" disabled={busy} onClick={() => void toggleArchive()} data-testid="archive-model">
                    {model.status === "archived" ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                    {model.status === "archived" ? "Restore" : "Archive"}
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={inUse ? 0 : -1}>
                        <Button
                          variant="destructive"
                          size="lg"
                          disabled={busy || inUse}
                          onClick={() => setDeleteOpen(true)}
                          data-testid="delete-model"
                        >
                          <Trash2Icon />
                          Delete
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {inUse ? <TooltipContent>Named by a published workflow; archive it instead.</TooltipContent> : null}
                  </Tooltip>
                </>
              ) : null}
            </div>
          </div>
        </header>
      </StickyHeader>

      {!isOrg ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>A platform model</AlertTitle>
          <AlertDescription>
            Shipped with the engine and served to every organization. Your own models resolve first, so training one
            under this name is refused; pick a new name and the picker lists both.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs value={activeTab} onValueChange={setTab}>
            <TabsList variant="line">
              <TabsTrigger value="overview" data-testid="tab-overview">
                Overview
              </TabsTrigger>
              <TabsTrigger value="manifest" data-testid="tab-manifest">
                Manifest
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {activeTab === "overview" ? (
            <div className="flex flex-col gap-4">
              {metrics ? (
                <SectionCard
                  title="Evaluation"
                  description="Measured by the training job on its validation split, at the operating confidence."
                  testId="model-metrics"
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
                      valueTestId="model-operating-confidence"
                      hint={typeof metrics.confidence === "number" ? "F1-max threshold" : "Not measured by this job"}
                    />
                  </div>
                  {typeof confidence === "number" ? (
                    <p className="text-[11px] text-muted-foreground">
                      The threshold precision and recall were measured at. Picking this model in a template sets the
                      detection node's min confidence to {formatMetric(confidence, 2)}.
                    </p>
                  ) : null}
                </SectionCard>
              ) : null}

              <SectionCard
                title="Classes"
                description="In index order, as the model emits them. A gate downstream matches on these names."
                testId="model-classes"
              >
                {model.classNames.length === 0 ? (
                  <p className="text-xs text-muted-foreground">This family emits no class list.</p>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  {model.classNames.map((c, i) => (
                    <span key={c} className="inline-flex items-center gap-1.5 rounded border border-border px-1.5 py-0.5 font-mono text-[11px]">
                      <span className="text-muted-foreground tabular-nums">{i}</span>
                      {c}
                    </span>
                  ))}
                </div>
              </SectionCard>

              {isOrg ? (
                <SectionCard title="Lineage" description="Where this version came from, so a result can be traced back and reproduced." testId="model-lineage">
                  <FactGrid>
                    <Fact label="Recipe" value={prov?.recipe ?? "—"} mono />
                    <Fact label="Base weights" value={prov?.base?.ref ?? "—"} mono />
                    <Fact label="Epochs" value={prov?.epochsCompleted ?? "—"} mono />
                    <Fact
                      label="Dataset"
                      value={
                        model.lineage ? (
                          <Link to="/datasets/$id" params={{ id: model.lineage.datasetId }} search={{ tab: "versions" }} className="text-primary underline-offset-2 hover:underline">
                            {model.lineage.datasetName} v{model.lineage.datasetVersion}
                          </Link>
                        ) : prov?.datasetId ? (
                          <span className="text-muted-foreground">deleted dataset</span>
                        ) : (
                          "—"
                        )
                      }
                    />
                    <Fact
                      label="Job"
                      value={
                        jobId ? (
                          <Link to="/training-jobs/$id" params={{ id: jobId }} className="font-mono text-xs text-primary underline-offset-2 hover:underline">
                            {shortId(jobId)}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">placed by hand</span>
                        )
                      }
                    />
                  </FactGrid>
                </SectionCard>
              ) : null}

              {model.versions && model.versions.length > 1 ? (
                <SectionCard
                  title="Versions of this name"
                  description="A workflow that names the model without a version gets the newest ready one; pin a version to hold it."
                  testId="model-versions"
                >
                  <div className="flex flex-wrap gap-1">
                    {[...model.versions]
                      .sort((a, b) => b.version - a.version)
                      .map((v) => (
                        <Link
                          key={v.id}
                          to="/models/$id"
                          params={{ id: v.id }}
                          className={cn(
                            "rounded-md border px-2 py-1 font-mono text-[11px] transition-colors hover:bg-muted/50",
                            v.id === model.id ? "border-primary bg-primary/10" : "border-border",
                            v.status === "archived" ? "line-through opacity-60" : "",
                          )}
                          aria-current={v.id === model.id ? "page" : undefined}
                        >
                          v{v.version}
                        </Link>
                      ))}
                  </div>
                </SectionCard>
              ) : null}

              <SectionCard
                title="Used by"
                description="Published workflow versions that name this model. A model in use can be archived but not deleted."
                testId="model-usage"
              >
                {inUse ? (
                  <ul className="flex flex-col gap-1 text-xs">
                    {model.usage.map((u) => (
                      <li key={`${u.templateId}:${u.version}:${u.nodeId}`} className="flex items-center gap-2">
                        <WorkflowIcon className="size-3.5 text-muted-foreground" />
                        <Link to="/workflow-templates/$id" params={{ id: u.templateId }} className="font-medium text-primary underline-offset-2 hover:underline">
                          {u.templateName}
                        </Link>
                        <span className="text-muted-foreground">
                          v{u.version}, node <span className="font-mono">{u.nodeId}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">No published workflow version names this model yet.</p>
                )}
              </SectionCard>
            </div>
          ) : (
            <SectionCard
              title="Manifest"
              description="manifest.json as published, byte for byte: what the engine reads to load the model."
              testId="model-manifest"
            >
              <div className="rounded-md border border-border bg-muted/30 p-2">
                <JsonTree value={model.manifest} />
              </div>
            </SectionCard>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <SectionCard title="Use in a workflow">
            <ol className="flex flex-col gap-2 text-xs">
              <li className="flex gap-2">
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">1</span>
                <span>
                  Open a workflow template and add a <span className="font-medium">{model.family}</span> node.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">2</span>
                <span className="min-w-0">
                  Pick <code className="rounded bg-muted px-1 font-mono text-[11px]">{ref}</code> in its model field.
                  {typeof confidence === "number" ? ` Min confidence prefills to ${formatMetric(confidence, 2)}.` : ""}
                </span>
              </li>
              <li className="flex gap-2">
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">3</span>
                <span>Publish the version; devices running it fetch the model on the next start.</span>
              </li>
            </ol>
            <Button variant="outline" size="sm" asChild>
              <Link to="/workflow-templates">
                <WorkflowIcon />
                Workflow templates
              </Link>
            </Button>
          </SectionCard>
          <SectionCard title="Model" testId="model-facts">
            <FactGrid columns={2}>
              <Fact label="Backend" value={model.manifest.backend ?? "—"} mono />
              <Fact label="Quantization" value={model.manifest.quantization ?? "—"} mono />
              <Fact
                label="Input"
                value={input?.width && input?.height ? `${input.width}×${input.height} ${input.layout ?? ""} ${input.colorSpace ?? ""}`.trim() : "—"}
                mono
                span
              />
              <Fact label="Classes" value={model.classNames.length} />
              <Fact label={isOrg ? "Trained" : "Added"} value={isOrg ? formatDateTime(prov?.trainedAt ?? model.createdAt) : "platform"} />
              <Fact label="Prefix" value={<span className="break-all">{model.s3Prefix}</span>} mono span />
            </FactGrid>
          </SectionCard>
        </aside>
      </div>

      <DestroyDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this model?"
        description={
          <>
            <span className="font-mono">{ref}</span> and its files under the organization registry are removed.
          </>
        }
        warning="A workflow that names this version by number will fail to resolve it. Version numbers are never reused."
        confirmLabel="Delete model"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          try {
            await deleteModel(model.id)
            toast.success("Model deleted")
            invalidate.registry()
            navigate({ to: "/models" })
          } catch (err) {
            toast.error(xgMessage(err))
          }
        }}
      />
    </div>
  )
}
