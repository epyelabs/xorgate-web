import { useMemo } from "react"
import {
  ActivityIcon,
  FlaskConicalIcon,
  HistoryIcon,
  SquareFunctionIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FUNCTION_NODE_RUNTIMES } from "@/lib/code-function-mock"
import { readFunctionConfig } from "@/lib/code-function-runtime"
import { useWorkflowEditor } from "@/store/workflow-editor"
import { CodeTab } from "./code-tab"
import { MonitorTab } from "./monitor-tab"
import { TestTab } from "./test-tab"
import { VersionsTab } from "./versions-tab"

// UI/UX MOCKUP — full-screen Lambda-style editor for Code Function nodes.
// Mounted once at the template page level (not inside the node popover) and
// driven by `functionEditorNodeId` in the workflow-editor store. All state
// lives in the node's config jsonb (code = $LATEST, versions = published
// snapshots), so it round-trips through draft save / JSON view untouched.

export function CodeFunctionEditorHost() {
  const nodeId = useWorkflowEditor((s) => s.functionEditorNodeId)
  const closeFunctionEditor = useWorkflowEditor((s) => s.closeFunctionEditor)
  if (!nodeId) return null
  return (
    <Dialog open onOpenChange={(open) => !open && closeFunctionEditor()}>
      <CodeFunctionEditorContent nodeId={nodeId} />
    </Dialog>
  )
}

function CodeFunctionEditorContent({ nodeId }: { nodeId: string }) {
  const node = useWorkflowEditor((s) => s.nodes.find((n) => n.id === nodeId))
  const updateNodeLabel = useWorkflowEditor((s) => s.updateNodeLabel)

  const catalogType = node?.data.catalogType ?? ""
  const runtime = FUNCTION_NODE_RUNTIMES[catalogType]
  const fn = useMemo(
    () => (node ? readFunctionConfig(catalogType, node.data.config) : null),
    [node, catalogType],
  )

  if (!node || !runtime || !fn) return null

  const latestPublished = fn.versions[0]
  const hasUnpublishedChanges = !latestPublished || latestPublished.code !== fn.code

  return (
    <DialogContent
      className="flex h-[88svh] flex-col gap-3 sm:max-w-[min(1100px,calc(100%-3rem))]"
      // Monaco needs its focus; don't let Radix steal it back on open.
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      <DialogHeader className="pr-10">
        <div className="flex flex-wrap items-center gap-2">
          <SquareFunctionIcon className="size-4 shrink-0 text-indigo-500" />
          <DialogTitle asChild>
            <h2 className="sr-only">Function editor</h2>
          </DialogTitle>
          <Input
            aria-label="Function name"
            className="h-7 w-56 font-heading text-sm font-medium"
            value={node.data.label}
            onChange={(e) => updateNodeLabel(nodeId, e.target.value)}
          />
          <Badge variant="outline">{runtime.runtimeLabel}</Badge>
          <Badge variant="secondary">
            {fn.deployedVersion !== null ? `Live: v${fn.deployedVersion}` : "Not deployed"}
          </Badge>
          {hasUnpublishedChanges ? (
            <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
              Unpublished changes
            </Badge>
          ) : null}
        </div>
        <DialogDescription>
          {catalogType} · handler <code>{fn.handler}</code> · {fn.timeoutMs} ms timeout ·{" "}
          {fn.memoryMb} MB
        </DialogDescription>
      </DialogHeader>

      <Tabs defaultValue="code" className="min-h-0 flex-1">
        <TabsList>
          <TabsTrigger value="code">
            <SquareFunctionIcon /> Code
          </TabsTrigger>
          <TabsTrigger value="test">
            <FlaskConicalIcon /> Test
          </TabsTrigger>
          <TabsTrigger value="monitor">
            <ActivityIcon /> Monitor
          </TabsTrigger>
          <TabsTrigger value="versions">
            <HistoryIcon /> Versions
          </TabsTrigger>
        </TabsList>
        <TabsContent value="code" className="min-h-0">
          <CodeTab nodeId={nodeId} catalogType={catalogType} fn={fn} />
        </TabsContent>
        <TabsContent value="test" className="min-h-0">
          <TestTab catalogType={catalogType} fn={fn} />
        </TabsContent>
        <TabsContent value="monitor" className="min-h-0">
          <MonitorTab nodeId={nodeId} fn={fn} />
        </TabsContent>
        <TabsContent value="versions" className="min-h-0">
          <VersionsTab nodeId={nodeId} fn={fn} />
        </TabsContent>
      </Tabs>
    </DialogContent>
  )
}
