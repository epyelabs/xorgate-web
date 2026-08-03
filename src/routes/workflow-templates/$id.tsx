import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { toast } from "sonner"
import {
  BracesIcon,
  CircleAlertIcon,
  PlayIcon,
  WorkflowIcon,
  XIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { parsePublishIssues } from "@/lib/workflow-catalog-schemas"
import { cn } from "@/lib/utils"
import {
  deleteWorkflowTemplate,
  getWorkflowTemplate,
  publishVersion,
  restoreVersion,
  saveDraftVersion,
  updateWorkflowTemplate,
} from "@/lib/workflow-templates-api"
import {
  getWorkflowTemplateResponseSchema,
  type WorkflowTemplateDetail,
  type WorkflowTemplateVersion,
} from "@/lib/workflow-schemas"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import { useWorkflowCatalog } from "@/store/workflow-catalog"
import { useWorkflowEditor } from "@/store/workflow-editor"
import { CodeFunctionEditorHost } from "./-components/code-function/code-function-editor"
import { JsonEditor } from "./-components/json-editor"
import { NodePalette } from "./-components/node-palette"
import { SettingsSheet } from "./-components/settings-sheet"
import { SimulatorPanel } from "./-components/simulator-panel"
import { TemplateHeader } from "./-components/template-header"
import { TemplateMeta } from "./-components/template-meta"
import { UsageSheet } from "./-components/usage-sheet"
import { VersionsSheet } from "./-components/versions-sheet"
import { WorkflowCanvas } from "./-components/workflow-canvas"

export const Route = createFileRoute("/workflow-templates/$id")({
  beforeLoad: requireAuth,
  component: WorkflowTemplateDetailPage,
})

type EditorMode = "gui" | "json"

// Prefer the open working draft, else the published version, else the newest.
function pickInitialVersion(
  t: WorkflowTemplateDetail
): WorkflowTemplateVersion | null {
  return (
    t.versions.find((v) => v.status === "draft") ??
    t.versions.find((v) => v.version === t.publishedVersion) ??
    [...t.versions].sort((a, b) => b.version - a.version)[0] ??
    null
  )
}

function WorkflowTemplateDetailPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const [template, setTemplate] = useState<WorkflowTemplateDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [editorMode, setEditorMode] = useState<EditorMode>("gui")
  // The simulator lives in a right-side panel on the editor, closed by default.
  const [showSimulator, setShowSimulator] = useState(false)
  // Side sheets, each opened from the header (version selector / "Used by" /
  // overflow menu), closed by default.
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [usageOpen, setUsageOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loadedVersionId, setLoadedVersionId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Bumped whenever a different version is loaded so the JSON buffer re-seeds.
  const [jsonRevision, setJsonRevision] = useState(0)

  const dirty = useWorkflowEditor((s) => s.dirty)
  const publishIssues = useWorkflowEditor((s) => s.publishIssues)
  // Node cards register TYPED handles (one per catalog port) only once the
  // catalog resolves; loaded edges carry those port ids as source/targetHandle.
  // Mounting the canvas before the catalog settles makes react-flow drop edges
  // whose handles aren't registered yet, so gate the canvas on it.
  const catalogStatus = useWorkflowCatalog((s) => s.status)

  // The palette, node cards, config forms, and edge typing all render from the
  // served catalog; kick the fetch off with the page.
  useEffect(() => {
    void useWorkflowCatalog.getState().ensureLoaded()
  }, [])

  const loadVersionIntoEditor = (version: WorkflowTemplateVersion) => {
    useWorkflowEditor.getState().loadDefinition(version.definition)
    setLoadedVersionId(version.id)
    setJsonRevision((n) => n + 1)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const raw = await getWorkflowTemplate(id)
        const parsed = getWorkflowTemplateResponseSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error("Unexpected /workflow-templates/:id response shape")
        }
        if (cancelled) return
        const fetched = parsed.data.template
        setTemplate(fetched)
        useBreadcrumbStore.getState().setTemplateName(fetched.name)
        const initial = pickInitialVersion(fetched)
        if (initial) loadVersionIntoEditor(initial)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          if (!cancelled) setNotFound(true)
          return
        }
        const message = (err as Error).message
        if (!cancelled) setError(message)
        toast.error(message)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Clear breadcrumb name + editor state when leaving the page.
  useEffect(() => {
    return () => {
      useBreadcrumbStore.getState().setTemplateName(null)
      useWorkflowEditor.getState().reset()
    }
  }, [id])

  const loadedVersion =
    template?.versions.find((v) => v.id === loadedVersionId) ?? null

  // --- Mutations -------------------------------------------------------------

  const persistMeta = async (updates: {
    name?: string
    description?: string | null
  }) => {
    try {
      const { template: updated } = await updateWorkflowTemplate(id, updates)
      setTemplate(updated)
      useBreadcrumbStore.getState().setTemplateName(updated.name)
      toast.success("Details saved")
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  // Saves the working graph as a draft and returns the resulting draft version.
  const saveDraft = async (): Promise<WorkflowTemplateVersion | null> => {
    const definition = useWorkflowEditor.getState().toDefinition()
    const { template: updated, version } = await saveDraftVersion(
      id,
      definition
    )
    setTemplate(updated)
    setLoadedVersionId(version.id)
    useWorkflowEditor.getState().markSaved()
    return version
  }

  const handleSaveDraft = async () => {
    setBusy(true)
    try {
      await saveDraft()
      toast.success("Draft saved")
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // A failed publish returns typed validation issues (WORKFLOW_VALIDATION_FAILED);
  // push them into the editor store so the canvas highlights the offending
  // nodes/edges, and summarize in a toast. Other errors toast as before.
  const surfacePublishError = (err: unknown): void => {
    const issues =
      err instanceof ApiError ? parsePublishIssues(err.message) : null
    if (issues && issues.length > 0) {
      useWorkflowEditor.getState().setPublishIssues(issues)
      toast.error(
        `Publish blocked: ${issues.length} validation ${issues.length === 1 ? "issue" : "issues"}`,
      )
      return
    }
    toast.error((err as Error).message)
  }

  const handlePublish = async () => {
    setBusy(true)
    try {
      // Publish whatever is on the canvas: persist it first if there are edits.
      let versionId = loadedVersionId
      if (dirty || !versionId) {
        const draft = await saveDraft()
        versionId = draft?.id ?? versionId
      }
      if (!versionId) throw new Error("Nothing to publish")
      const { template: updated } = await publishVersion(id, versionId)
      setTemplate(updated)
      setLoadedVersionId(versionId)
      useWorkflowEditor.getState().markSaved()
      useWorkflowEditor.getState().setPublishIssues([])
      toast.success("Template published")
    } catch (err) {
      surfacePublishError(err)
    } finally {
      setBusy(false)
    }
  }

  const handlePublishVersion = async (version: WorkflowTemplateVersion) => {
    setBusy(true)
    try {
      const { template: updated } = await publishVersion(id, version.id)
      setTemplate(updated)
      const published = updated.versions.find((v) => v.id === version.id)
      if (published) loadVersionIntoEditor(published)
      toast.success(`Published v${version.version}`)
    } catch (err) {
      surfacePublishError(err)
    } finally {
      setBusy(false)
    }
  }

  const handleRestore = async (version: WorkflowTemplateVersion) => {
    setBusy(true)
    try {
      const { template: updated, version: draft } = await restoreVersion(
        id,
        version.id
      )
      setTemplate(updated)
      const fresh = updated.versions.find((v) => v.id === draft.id)
      if (fresh) loadVersionIntoEditor(fresh)
      setVersionsOpen(false)
      toast.success(`Restored v${version.version} into a new draft`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // The panel's delete button is disabled while `usage` is non-empty, and the
  // backend 409s as the backstop, so a success here means the template (plus
  // versions/run history) is gone — leave the page.
  const handleDelete = async () => {
    setBusy(true)
    try {
      await deleteWorkflowTemplate(id)
      toast.success("Template deleted")
      setSettingsOpen(false)
      void navigate({ to: "/workflow-templates" })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleViewVersion = (version: WorkflowTemplateVersion) => {
    loadVersionIntoEditor(version)
    setVersionsOpen(false)
  }

  // --- Render ----------------------------------------------------------------

  if (notFound) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <p className="text-sm text-muted-foreground">
          Workflow template not found.
        </p>
      </div>
    )
  }

  if (error && !template) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  // Wait for the catalog to settle before mounting the editor so node cards can
  // register their typed handles and loaded edges bind on the first paint.
  // "error" counts as settled: NodePalette surfaces the error + a Retry button,
  // so the editor must still mount.
  if (!template || catalogStatus === "idle" || catalogStatus === "loading") {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4 pt-0">
        <Skeleton className="h-12 w-full max-w-2xl" />
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-[440px] w-full" />
      </div>
    )
  }

  return (
    // Pin the editor to the viewport (minus the app header: h-16, or h-12 when the
    // sidebar is icon-collapsed) so it has a *definite* height. The shell wrapper is
    // only `min-h-svh`, so a plain `flex-1` here would grow the page instead of
    // capping it — then tall panel content (e.g. the simulator Frames tab) would
    // scroll the whole page rather than scrolling inside the panel.
    <div className="flex h-[calc(100svh-4rem)] min-h-0 flex-col gap-3 p-4 pt-0 group-has-data-[collapsible=icon]/sidebar-wrapper:h-[calc(100svh-3rem)]">
      <TemplateHeader
        template={template}
        loadedVersion={loadedVersion}
        dirty={dirty}
        busy={busy}
        onOpenVersions={() => setVersionsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onSaveDraft={handleSaveDraft}
        onPublish={handlePublish}
      />

      {/* The editor fills the remaining viewport height. GUI / JSON are two
          views of the same graph, toggled in the toolbar. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card/40 px-4 py-1.5">
          <TemplateMeta
            template={template}
            onOpenUsage={() => setUsageOpen(true)}
          />
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-md border border-border p-0.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditorMode("gui")}
                className={cn(
                  editorMode === "gui"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground"
                )}
              >
                <WorkflowIcon className="size-3.5" />
                Graph
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditorMode("json")}
                className={cn(
                  editorMode === "json"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground"
                )}
              >
                <BracesIcon className="size-3.5" />
                JSON
              </Button>
            </div>
            <div className="h-5 w-px shrink-0 bg-border" aria-hidden />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSimulator((s) => !s)}
              aria-pressed={showSimulator}
              className={cn(
                "border-2 py-3",
                showSimulator && "ring-2 ring-primary/30"
              )}
            >
              <PlayIcon className="size-3.5" />
              Run Simulation
            </Button>
          </div>
        </div>
        {publishIssues.length > 0 ? (
          <div className="flex shrink-0 items-start gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-2">
            <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-destructive">
                Publish blocked by {publishIssues.length} validation{" "}
                {publishIssues.length === 1 ? "issue" : "issues"}
              </p>
              <ul className="mt-0.5 max-h-24 list-disc overflow-y-auto pl-4 text-[11px] text-muted-foreground">
                {publishIssues.map((issue, i) => (
                  <li key={i}>{issue.message}</li>
                ))}
              </ul>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => useWorkflowEditor.getState().setPublishIssues([])}
              title="Dismiss"
              aria-label="Dismiss validation issues"
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            {editorMode === "gui" ? (
              <div className="flex h-full">
                <NodePalette />
                <div className="min-w-0 flex-1">
                  {/* Remount if the catalog transitions (e.g. error -> Retry ->
                      ready) so handles re-register and edges re-bind. In the
                      normal gated path status is already settled here, so the
                      key is stable and this is a no-op. */}
                  <WorkflowCanvas key={catalogStatus} />
                </div>
              </div>
            ) : (
              <JsonEditor revision={jsonRevision} />
            )}
          </div>
          {showSimulator ? (
            <SimulatorPanel
              templateId={id}
              onClose={() => setShowSimulator(false)}
            />
          ) : null}
        </div>
      </div>

      {/* Full-screen Lambda-style editor for Code Function nodes; opened from
          the node popover, driven by the workflow-editor store. */}
      <CodeFunctionEditorHost />

      <VersionsSheet
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        versions={template.versions}
        loadedVersionId={loadedVersionId}
        busy={busy}
        onView={handleViewVersion}
        onRestore={handleRestore}
        onPublish={handlePublishVersion}
      />

      <UsageSheet
        open={usageOpen}
        onOpenChange={setUsageOpen}
        instances={template.usage}
      />

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        template={template}
        busy={busy}
        onSave={(updates) => persistMeta(updates)}
        onDelete={handleDelete}
        onShowUsage={() => {
          setSettingsOpen(false)
          setUsageOpen(true)
        }}
      />
    </div>
  )
}
