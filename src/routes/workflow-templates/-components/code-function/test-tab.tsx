import { useState } from "react"
import Editor from "@monaco-editor/react"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  PlayIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FUNCTION_NODE_RUNTIMES } from "@/lib/code-function-runtime"
import {
  type FunctionConfig,
  runTestEvent,
  SAMPLE_TEST_EVENTS,
  type TestRunResult,
} from "@/lib/code-function-runtime"
import { setupMonaco } from "@/lib/monaco-setup"

setupMonaco()

// Lambda-style test console: paste/pick a JSON event, invoke the current
// $LATEST code, inspect result + logs. JavaScript really executes (throwaway
// Web Worker in the user's browser, hard timeout); Python is simulated until
// the backend cloud runtime exists, and says so on the result card.
export function TestTab({
  catalogType,
  fn,
}: {
  catalogType: string
  fn: FunctionConfig
}) {
  const [eventText, setEventText] = useState(() =>
    JSON.stringify(SAMPLE_TEST_EVENTS[0].body, null, 2),
  )
  const [running, setRunning] = useState(false)
  const [run, setRun] = useState<TestRunResult | null>(null)
  const [eventError, setEventError] = useState<string | null>(null)
  const runtime = FUNCTION_NODE_RUNTIMES[catalogType]
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")

  const handleRun = async () => {
    let event: unknown
    try {
      event = JSON.parse(eventText)
    } catch (err) {
      setEventError((err as Error).message)
      return
    }
    setEventError(null)
    setRunning(true)
    try {
      setRun(
        await runTestEvent({
          catalogType,
          code: fn.code,
          handler: fn.handler,
          event,
          timeoutMs: fn.timeoutMs,
        }),
      )
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-2">
      {/* Left: the test event */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border">
        <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-2 py-1.5">
          <span className="text-xs font-medium">Test event</span>
          <div className="flex items-center gap-2">
            <Select
              onValueChange={(id) => {
                const sample = SAMPLE_TEST_EVENTS.find((s) => s.id === id)
                if (sample) setEventText(JSON.stringify(sample.body, null, 2))
              }}
            >
              <SelectTrigger className="h-7 w-40">
                <SelectValue placeholder="Load a template…" />
              </SelectTrigger>
              <SelectContent>
                {SAMPLE_TEST_EVENTS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleRun} disabled={running}>
              {running ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
              Run test
            </Button>
          </div>
        </div>
        {eventError ? (
          <p className="flex items-center gap-1.5 border-b border-border px-2 py-1 text-[11px] text-destructive">
            <AlertCircleIcon className="size-3" /> {eventError}
          </p>
        ) : null}
        <div className="min-h-0 flex-1">
          <Editor
            height="100%"
            defaultLanguage="json"
            value={eventText}
            onChange={(v) => setEventText(v ?? "")}
            theme={isDark ? "vs-dark" : "light"}
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              tabSize: 2,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              lineNumbersMinChars: 3,
              renderLineHighlight: "none",
            }}
          />
        </div>
      </div>

      {/* Right: the invocation result */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border">
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-2 py-1.5">
          <span className="text-xs font-medium">Result</span>
          {run ? (
            <>
              {run.ok ? (
                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2Icon /> Succeeded
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <AlertCircleIcon /> Failed
                </Badge>
              )}
              {run.simulated ? <Badge variant="outline">Simulated</Badge> : null}
              <span className="ml-auto text-[11px] text-muted-foreground">
                {run.durationMs.toFixed(1)} ms · {fn.memoryMb} MB
              </span>
            </>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!run ? (
            <p className="text-[11px] text-muted-foreground">
              Run a test to invoke <code>{fn.handler}</code> with the event on the
              left.{" "}
              {runtime.language === "javascript"
                ? "JavaScript executes locally in your browser (mock of the cloud runtime)."
                : "Python execution is simulated in this preview; the cloud runtime lands with the backend."}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <p className="mb-1 text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                  {run.ok ? "Response" : "Error"}
                </p>
                <pre
                  className={`overflow-x-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap ${
                    run.ok ? "" : "text-destructive"
                  }`}
                >
                  {run.ok ? JSON.stringify(run.result, null, 2) : run.error}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                  Logs
                </p>
                {run.logs.length > 0 ? (
                  <pre className="overflow-x-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                    {run.logs.join("\n")}
                  </pre>
                ) : (
                  <p className="text-[11px] text-muted-foreground">No log output.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
