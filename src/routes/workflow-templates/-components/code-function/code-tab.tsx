import Editor from "@monaco-editor/react"
import { InfoIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { FUNCTION_NODE_RUNTIMES } from "@/lib/code-function-mock"
import type { FunctionConfig } from "@/lib/code-function-runtime"
import { setupMonaco } from "@/lib/monaco-setup"
import { useWorkflowEditor } from "@/store/workflow-editor"

setupMonaco()

// The $LATEST source editor. Edits write straight into the node's config
// (config.code) via the editor store, so the template's normal Save draft
// flow persists them — same model as every other node config field.
export function CodeTab({
  nodeId,
  catalogType,
  fn,
}: {
  nodeId: string
  catalogType: string
  fn: FunctionConfig
}) {
  const updateNodeConfig = useWorkflowEditor((s) => s.updateNodeConfig)
  const runtime = FUNCTION_NODE_RUNTIMES[catalogType]
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-2 py-1.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs">{runtime.fileName}</span>
          <Badge variant="outline">$LATEST</Badge>
        </div>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <InfoIcon className="size-3" />
          <span>
            <code>{fn.handler}(event, context)</code> runs once per incoming event
          </span>
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          language={runtime.monacoLanguage}
          path={`fn-${nodeId}/${runtime.fileName}`}
          value={fn.code}
          onChange={(value) => updateNodeConfig(nodeId, "code", value ?? "")}
          theme={isDark ? "vs-dark" : "light"}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            tabSize: runtime.language === "python" ? 4 : 2,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            lineNumbersMinChars: 3,
            folding: true,
            renderLineHighlight: "none",
          }}
        />
      </div>
    </div>
  )
}
