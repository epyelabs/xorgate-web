import { useEffect, useRef, useState } from "react"
import { LoaderIcon, PlayIcon, ZapIcon } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  SIMULATION_FIXTURES,
  simulate,
} from "@/lib/workflow-templates-api"
import type { SimulationResult } from "@/lib/workflow-schemas"
import { useWorkflowEditor } from "@/store/workflow-editor"
import { cn } from "@/lib/utils"

// Mock simulator. It runs the *current* editor graph against a canned input and
// animates a node-by-node step-through, then lists the events that would be
// produced. No real execution — the result comes from the API shim.
export function SimulatorPanel({ templateId }: { templateId: string }) {
  const [fixtureId, setFixtureId] = useState<string>(SIMULATION_FIXTURES[0].id)
  const [running, setRunning] = useState(false)
  const [revealed, setRevealed] = useState(0)
  const [result, setResult] = useState<SimulationResult | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const run = async () => {
    const definition = useWorkflowEditor.getState().toDefinition()
    if (definition.nodes.length === 0) {
      toast.error("Add some nodes to the workflow before simulating.")
      return
    }
    setRunning(true)
    setResult(null)
    setRevealed(0)
    try {
      const res = await simulate(templateId, definition, fixtureId)
      setResult(res)
      // Reveal steps one at a time for a sense of execution.
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        setRevealed((n) => {
          if (n >= res.steps.length) {
            if (timerRef.current) clearInterval(timerRef.current)
            setRunning(false)
            return n
          }
          return n + 1
        })
      }, 280)
    } catch (err) {
      toast.error((err as Error).message)
      setRunning(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle>Run trace</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={fixtureId} onValueChange={setFixtureId} disabled={running}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SIMULATION_FIXTURES.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={run} disabled={running}>
              {running ? <LoaderIcon className="animate-spin" /> : <PlayIcon />}
              Run
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!result ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              Pick a sample input and run the workflow to see each node execute.
            </p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {result.steps.map((step, index) => {
                const done = index < revealed
                const active = index === revealed && running
                return (
                  <li
                    key={step.nodeId}
                    className={cn(
                      "flex items-center gap-3 rounded-md border px-3 py-2 transition-colors",
                      done
                        ? "border-border bg-card"
                        : "border-dashed border-border/60 opacity-50",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
                        done
                          ? "bg-emerald-500/15 text-emerald-600"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {active ? (
                        <LoaderIcon className="size-3 animate-spin" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span className="flex-1 text-xs font-medium">{step.label}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {done ? step.output : "—"}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <ZapIcon className="size-3.5 text-primary" />
            Events produced
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!result || running ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {running ? "Running…" : "No run yet."}
            </p>
          ) : result.events.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No events for this input.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {result.events.map((event, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
                >
                  <div className="flex flex-col">
                    <span className="font-mono text-xs">{event.kind}</span>
                    <span className="text-[10px] text-muted-foreground">
                      at {event.at} · clip attached
                    </span>
                  </div>
                  <Badge variant="secondary">
                    {Math.round(event.confidence * 100)}%
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
