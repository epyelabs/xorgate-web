import { useEffect, useRef, useState } from "react"
import Editor from "@monaco-editor/react"
import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { setupMonaco } from "@/lib/monaco-setup"
import {
  attachWorkflowInputSchema,
  type AttachWorkflowInput,
} from "@/lib/device-workflow-schemas"

setupMonaco()

// JSON view of the full attach config. The buffer re-seeds from `value` whenever
// `revision` bumps (i.e. each GUI→JSON switch); debounced edits are validated by
// the same Zod schema the form uses and pushed back up via `onChange` on success
// so the form and JSON stay in sync. Mirrors the template editor's json-editor.
export function AttachConfigJson({
  value,
  onChange,
  revision,
}: {
  value: AttachWorkflowInput
  onChange: (next: AttachWorkflowInput) => void
  revision: number
}) {
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Seed (and re-seed) the buffer from the current config. Only when the parent
  // bumps the revision (each GUI→JSON switch), not on every keystroke-driven
  // `value` change — that would clobber in-progress edits.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setText(JSON.stringify(value, null, 2))
    setError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const apply = (next: string) => {
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(next)
    } catch (err) {
      setError((err as Error).message)
      return
    }
    const result = attachWorkflowInputSchema.safeParse(parsedJson)
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Invalid attach config")
      return
    }
    setError(null)
    onChange(result.data)
  }

  const handleChange = (next?: string) => {
    const nextText = next ?? ""
    setText(nextText)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => apply(nextText), 350)
  }

  const handleFormat = () => {
    try {
      const formatted = JSON.stringify(JSON.parse(text), null, 2)
      setText(formatted)
      apply(formatted)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-border">
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
              <span className="text-muted-foreground">Valid — form in sync</span>
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
