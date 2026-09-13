import { useEffect, useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { toast } from "sonner"
import { ArchiveIcon, ArchiveRestoreIcon, DownloadIcon, Trash2Icon } from "lucide-react"
import { isXorgateError } from "@xorgate/sdk"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { DestroyDialog } from "@/components/destroy-dialog"
import { JsonTree } from "@/components/json-tree"
import { StickyHeader } from "@/components/sticky-header"
import { cn } from "@/lib/utils"
import { xgMessage } from "@/lib/xorgate"
import { useHasPermission } from "@/lib/permissions"
import { deleteModel, getModelDownload, patchModel, triggerDownload } from "@/lib/models-api"
import { formatDateTime, formatMetric } from "@/lib/models-format"
import { modelRef, type ModelDetail } from "@/lib/models-schemas"
import { useInvalidateModels, useRegistryModel } from "@/queries/models"
import { useBreadcrumbStore } from "@/store/breadcrumb"

export const Route = createFileRoute("/models/$id")({
  beforeLoad: requireAuth,
  component: RegistryModelPage,
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

// One registry entry: scope, the manifest as published (byte for byte, with
// the forge's provenance), lineage back to the dataset version and job,
// sibling versions, usage by published templates, download, archive. Delete
// is refused by the backend while a published template names the model; the
// usage list here is the same query, so the button says so first.
function RegistryModelPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
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
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    )
  }

  const isOrg = model.scope === "organization"
  const prov = model.provenance
  const metrics = prov?.metrics ?? null
  const inUse = model.usage.length > 0
  const input = model.manifest.input

  return (
    <div className="flex flex-1 flex-col gap-5 p-4 pt-0" data-testid="model-detail" data-scope={model.scope}>
      <StickyHeader className="border-b border-border pb-4">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {model.name}
              <span className="ml-2 font-mono text-base text-muted-foreground">v{model.version}</span>
            </h1>
            <Badge variant={isOrg ? "default" : "secondary"}>{model.scope}</Badge>
            <Badge variant="outline">{model.family}</Badge>
            {model.status === "archived" ? <Badge variant="destructive">archived</Badge> : null}
            <span className="ml-auto flex items-center gap-2">
              {canDownload ? (
                <>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void download("manifest.json")} data-testid="download-manifest">
                    <DownloadIcon />
                    manifest.json
                  </Button>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void download("model.onnx")} data-testid="download-onnx">
                    <DownloadIcon />
                    model.onnx
                  </Button>
                </>
              ) : null}
              {canManage && isOrg ? (
                <>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void toggleArchive()} data-testid="archive-model">
                    {model.status === "archived" ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                    {model.status === "archived" ? "Restore" : "Archive"}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy || inUse}
                    title={inUse ? "Named by a published workflow; archive it instead" : undefined}
                    onClick={() => setDeleteOpen(true)}
                    data-testid="delete-model"
                  >
                    <Trash2Icon />
                    Delete
                  </Button>
                </>
              ) : null}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {model.label && model.label !== model.name ? model.label : "Named in a workflow as "}
            <span className="font-mono text-xs">{model.label && model.label !== model.name ? ` · ${modelRef(model.name, model.version)}` : modelRef(model.name, model.version)}</span>
          </p>
        </header>
      </StickyHeader>

      <Section title="Model" testId="model-facts">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          <Fact label="Backend" value={model.manifest.backend ?? "—"} mono />
          <Fact label="Input" value={input?.width && input?.height ? `${input.width}x${input.height} ${input.layout ?? ""} ${input.colorSpace ?? ""}` : "—"} mono />
          <Fact label="Quantization" value={model.manifest.quantization ?? "—"} mono />
          <Fact label="Classes" value={model.classNames.length} />
          <Fact label="Trained" value={isOrg ? formatDateTime(prov?.trainedAt ?? model.createdAt) : "platform"} />
          <Fact label="Prefix" value={model.s3Prefix} mono />
        </div>
        <div className="flex flex-wrap gap-1" data-testid="model-classes">
          {model.classNames.map((c) => (
            <span key={c} className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px]">
              {c}
            </span>
          ))}
        </div>
      </Section>

      {isOrg ? (
        <Section title="Lineage" testId="model-lineage">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Fact label="Recipe" value={`${prov?.recipe ?? "—"}${prov?.base?.ref ? ` from ${prov.base.ref}` : ""}`} mono />
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
                model.lineage?.jobId ?? prov?.jobId ? (
                  <Link to="/training-jobs/$id" params={{ id: (model.lineage?.jobId ?? prov?.jobId) as string }} className="font-mono text-xs text-primary underline-offset-2 hover:underline">
                    {(model.lineage?.jobId ?? prov?.jobId ?? "").slice(0, 8)}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">placed by hand</span>
                )
              }
            />
          </div>
          {metrics ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="model-metrics">
              <Fact label="mAP50" value={formatMetric(metrics.mAP50)} mono />
              <Fact label="mAP50-95" value={formatMetric(metrics.mAP50_95)} mono />
              <Fact label="Precision" value={formatMetric(metrics.precision)} mono />
              <Fact label="Recall" value={formatMetric(metrics.recall)} mono />
            </div>
          ) : null}
        </Section>
      ) : null}

      {model.versions && model.versions.length > 1 ? (
        <Section title="Versions of this name" testId="model-versions">
          <div className="flex flex-wrap gap-1">
            {model.versions.map((v) => (
              <Link
                key={v.id}
                to="/models/$id"
                params={{ id: v.id }}
                className={cn(
                  "rounded border px-2 py-0.5 font-mono text-[11px] hover:bg-muted/50",
                  v.id === model.id ? "border-primary bg-primary/10" : "border-border",
                  v.status === "archived" ? "line-through opacity-60" : "",
                )}
              >
                v{v.version}
              </Link>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Used by" testId="model-usage">
        {inUse ? (
          <ul className="flex flex-col gap-0.5 text-xs">
            {model.usage.map((u) => (
              <li key={`${u.templateId}:${u.version}:${u.nodeId}`}>
                <Link to="/workflow-templates/$id" params={{ id: u.templateId }} className="text-primary underline-offset-2 hover:underline">
                  {u.templateName}
                </Link>
                <span className="text-muted-foreground">
                  {" "}
                  v{u.version}, node <span className="font-mono">{u.nodeId}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No published workflow version names this model.</p>
        )}
      </Section>

      <Section title="Manifest" testId="model-manifest">
        <div className="rounded-md border border-border bg-muted/30 p-2">
          <JsonTree value={model.manifest} />
        </div>
      </Section>

      <DestroyDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this model?"
        description={
          <>
            <span className="font-mono">{modelRef(model.name, model.version)}</span> and its files under the organization
            registry are removed.
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
