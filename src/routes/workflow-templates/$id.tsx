import { useEffect, useState } from "react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { toast } from "sonner"
import { BracesIcon, PlayIcon, WorkflowIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
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
import { useAuthStore } from "@/store/auth"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import { useWorkflowEditor } from "@/store/workflow-editor"
import { JsonEditor } from "./-components/json-editor"
import { NodePalette } from "./-components/node-palette"
import { SettingsPanel } from "./-components/settings-panel"
import { TemplateHeader } from "./-components/template-header"
import { UsagePanel } from "./-components/usage-panel"
import { VersionsPanel } from "./-components/versions-panel"
import { WorkflowCanvas } from "./-components/workflow-canvas"

export const Route = createFileRoute("/workflow-templates/$id")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: WorkflowTemplateDetailPage,
})

type TabValue = "editor" | "versions" | "usage" | "settings"
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
  const [template, setTemplate] = useState<WorkflowTemplateDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [activeTab, setActiveTab] = useState<TabValue>("editor")
  const [editorMode, setEditorMode] = useState<EditorMode>("gui")
  // The simulator lives in a right-side panel on the Template tab, closed by default.
  const [showSimulator, setShowSimulator] = useState(false)
  const [loadedVersionId, setLoadedVersionId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Bumped whenever a different version is loaded so the JSON buffer re-seeds.
  const [jsonRevision, setJsonRevision] = useState(0)

  const dirty = useWorkflowEditor((s) => s.dirty)

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

  const handleSelectVersion = (versionId: string) => {
    const version = template?.versions.find((v) => v.id === versionId)
    if (version) loadVersionIntoEditor(version)
  }

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
      toast.success("Template published")
    } catch (err) {
      toast.error((err as Error).message)
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
      toast.error((err as Error).message)
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
      setActiveTab("editor")
      toast.success(`Restored v${version.version} into a new draft`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleViewVersion = (version: WorkflowTemplateVersion) => {
    loadVersionIntoEditor(version)
    setActiveTab("editor")
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

  if (!template) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4 pt-0">
        <Skeleton className="h-12 w-full max-w-2xl" />
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-[440px] w-full" />
      </div>
    )
  }

  return (
    // min-h-0 lets the Tabs/editor flex-fill the viewport height instead of
    // growing the page; the editor band then stretches to the bottom.
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 pt-0">
      <TemplateHeader
        template={template}
        loadedVersion={loadedVersion}
        dirty={dirty}
        busy={busy}
        onSelectVersion={handleSelectVersion}
        onSaveDraft={handleSaveDraft}
        onPublish={handlePublish}
        onSimulate={() => {
          setActiveTab("editor")
          setShowSimulator(true)
        }}
        onGoUsage={() => setActiveTab("usage")}
      />

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
        className="min-h-0 flex-1 gap-3"
      >
        <div className="shrink-0 border-b border-border">
          <TabsList variant="line">
            <TabsTrigger value="editor">Template</TabsTrigger>
            <TabsTrigger value="versions">Versions</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="editor" className="min-h-0">
          {/* Fills the remaining viewport height. GUI / JSON are two views of
              the same graph, toggled in the toolbar. */}
          <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card/40 px-4 py-1.5">
              <span className="text-xs text-muted-foreground">
                {editorMode === "gui"
                  ? "Drag nodes from the palette · click a node to edit its settings"
                  : "Edit the workflow definition as JSON — the graph stays in sync"}
              </span>
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
                  variant="default"
                  size="sm"
                  onClick={() => setShowSimulator((s) => !s)}
                  aria-pressed={showSimulator}
                  className={cn(showSimulator && "ring-2 ring-primary/30")}
                >
                  <PlayIcon className="size-3.5" />
                  Run Simulation
                </Button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1">
              <div className="min-w-0 flex-1">
                {editorMode === "gui" ? (
                  <div className="flex h-full">
                    <NodePalette />
                    <div className="min-w-0 flex-1">
                      <WorkflowCanvas />
                    </div>
                  </div>
                ) : (
                  <JsonEditor revision={jsonRevision} />
                )}
              </div>
              {showSimulator ? (
                <aside className="flex w-96 shrink-0 flex-col border-l border-border bg-card/40">
                  <div className="shrink-0 border-b border-border px-4 py-2 text-xs font-medium text-foreground">
                    Simulator
                  </div>
                  {/* Empty simulator container. Content lands here later. */}
                  <div className="min-h-0 flex-1" />
                </aside>
              ) : null}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="versions" className="min-h-0 overflow-auto">
          <VersionsPanel
            versions={template.versions}
            loadedVersionId={loadedVersionId}
            busy={busy}
            onView={handleViewVersion}
            onRestore={handleRestore}
            onPublish={handlePublishVersion}
          />
        </TabsContent>

        <TabsContent value="usage" className="min-h-0 overflow-auto">
          <UsagePanel instances={template.usage} />
        </TabsContent>

        <TabsContent value="settings" className="min-h-0 overflow-auto">
          <SettingsPanel
            template={template}
            busy={busy}
            onSave={(updates) => persistMeta(updates)}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
