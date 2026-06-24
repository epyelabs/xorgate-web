import { useEffect, useRef, useState } from "react"
import Editor from "@monaco-editor/react"
import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { setupMonaco } from "@/lib/monaco-setup"
import { useWorkflowEditor } from "@/store/workflow-editor"

setupMonaco()

// Manual editing view. The textual definition is the same `{ nodes, edges }`
// the graph renders; typing here updates the store (debounced) and the canvas
// follows. Invalid JSON / shape shows inline and blocks the graph update until
// fixed. `revision` bumps whenever the parent loads a different version so the
// buffer re-seeds from the freshly loaded definition.
export function JsonEditor({ revision }: { revision: number }) {
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Latest buffer + whether an edit is waiting, so we can flush on unmount
  // (e.g. toggling back to the graph before the debounce fires).
  const pendingRef = useRef<string | null>(null)

  // Seed (and re-seed) the buffer from the current store definition.
  useEffect(() => {
    setText(JSON.stringify(useWorkflowEditor.getState().toDefinition(), null, 2))
    setError(null)
    pendingRef.current = null
  }, [revision])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (pendingRef.current !== null) {
        useWorkflowEditor.getState().setFromJson(pendingRef.current)
      }
    }
  }, [])

  const handleChange = (value?: string) => {
    const next = value ?? ""
    setText(next)
    pendingRef.current = next
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setError(useWorkflowEditor.getState().setFromJson(next))
      pendingRef.current = null
    }, 350)
  }

  const handleFormat = () => {
    try {
      const formatted = JSON.stringify(JSON.parse(text), null, 2)
      setText(formatted)
      setError(useWorkflowEditor.getState().setFromJson(formatted))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-1.5 text-xs">
          {error ? (
            <>
              <AlertCircleIcon className="size-3.5 text-destructive" />
              <span className="text-destructive">{error}</span>
            </>
          ) : (
            <>
              <CheckCircle2Icon className="size-3.5 text-emerald-500" />
              <span className="text-muted-foreground">Valid — graph in sync</span>
            </>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={handleFormat}>
          Format
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          height="100%"
          defaultLanguage="json"
          value={text}
          onChange={handleChange}
          theme={isDark ? "vs-dark" : "light"}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            tabSize: 2,
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
