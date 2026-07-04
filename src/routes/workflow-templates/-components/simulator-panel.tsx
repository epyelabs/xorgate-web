import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { PlayIcon, XIcon } from "lucide-react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { NODE_CATALOG_BY_TYPE } from "@/lib/workflow-nodes"
import { simulate } from "@/lib/workflow-templates-api"
import type { SimulationResult, WorkflowDefinition } from "@/lib/workflow-schemas"
import { useWorkflowEditor } from "@/store/workflow-editor"
import { SourceInputRow } from "./source-input-row"
import { SourcePreviewDialog } from "./source-preview-dialog"
import { SimulatorOutput } from "./simulator-output"
import type { SourceBinding } from "./simulator-types"

const EMPTY_DEFINITION: WorkflowDefinition = { nodes: [], edges: [] }

// Revoke any in-browser object URL a binding created, so uploaded-video previews
// don't leak when unbound / replaced / on unmount.
function revoke(binding: SourceBinding | undefined) {
  if (binding && binding.kind === "video-file") URL.revokeObjectURL(binding.url)
}

// The "Workflow Testing" pane. Reads the live graph's source nodes, lets the user
// bind a concrete test input to each, and renders a mocked, type-adaptive output
// when "Run Workflow" is pressed. Nothing here talks to the run backend.
export function SimulatorPanel({
  templateId,
  onClose,
}: {
  templateId: string
  onClose: () => void
}) {
  const nodes = useWorkflowEditor((s) => s.nodes)

  // Source rows, with a per-type index suffix when a type appears more than once
  // (e.g. two "Video Stream" nodes -> "Video Stream 1" / "Video Stream 2").
  const sources = useMemo(() => {
    const src = nodes.filter(
      (n) => NODE_CATALOG_BY_TYPE[n.data.catalogType]?.group === "source",
    )
    const totals = new Map<string, number>()
    for (const n of src)
      totals.set(n.data.catalogType, (totals.get(n.data.catalogType) ?? 0) + 1)
    const seen = new Map<string, number>()
    return src.map((n) => {
      const ct = n.data.catalogType
      const base =
        n.data.label || NODE_CATALOG_BY_TYPE[ct]?.label || ct
      let label = base
      if ((totals.get(ct) ?? 0) > 1) {
        const idx = (seen.get(ct) ?? 0) + 1
        seen.set(ct, idx)
        label = `${base} ${idx}`
      }
      return { id: n.id, catalogType: ct, label }
    })
  }, [nodes])

  const [bindings, setBindings] = useState<Record<string, SourceBinding>>({})
  const [preview, setPreview] = useState<Extract<
    SourceBinding,
    { kind: "video-file" | "video-recording" }
  > | null>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [ranDefinition, setRanDefinition] =
    useState<WorkflowDefinition>(EMPTY_DEFINITION)
  // Both sections open initially; running the workflow collapses Sources so the
  // Output takes over (the user can re-open Sources anytime).
  const [openSections, setOpenSections] = useState<string[]>([
    "sources",
    "output",
  ])

  // Keep a live ref so the unmount cleanup revokes whatever is bound at the time.
  const bindingsRef = useRef(bindings)
  useEffect(() => {
    bindingsRef.current = bindings
  }, [bindings])
  useEffect(() => {
    return () => {
      for (const b of Object.values(bindingsRef.current)) revoke(b)
    }
  }, [])

  // Drop (and revoke) bindings whose source node was deleted from the graph.
  useEffect(() => {
    const ids = new Set(sources.map((s) => s.id))
    /* eslint-disable react-hooks/set-state-in-effect */
    setBindings((prev) => {
      const stale = Object.keys(prev).filter((id) => !ids.has(id))
      if (stale.length === 0) return prev
      const next = { ...prev }
      for (const id of stale) {
        revoke(next[id])
        delete next[id]
      }
      return next
    })
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [sources])

  const bind = (nodeId: string, binding: SourceBinding) =>
    setBindings((prev) => {
      revoke(prev[nodeId])
      return { ...prev, [nodeId]: binding }
    })

  const unbind = (nodeId: string) =>
    setBindings((prev) => {
      revoke(prev[nodeId])
      const next = { ...prev }
      delete next[nodeId]
      return next
    })

  const boundCount = sources.filter((s) => bindings[s.id]).length

  const runWorkflow = async () => {
    setRunning(true)
    try {
      const definition = useWorkflowEditor.getState().toDefinition()
      const res = await simulate(templateId, definition, "urban-hard-stops")
      setRanDefinition(definition)
      setResult(res)
      setOpenSections(["output"])
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <aside className="flex min-h-0 w-[28rem] shrink-0 flex-col overflow-hidden border-l border-border bg-card/40">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-1.5">
        <span className="text-xs font-medium text-foreground">
          Workflow Testing
        </span>
        <div className="flex items-center gap-2">
          {sources.length > 0 ? (
            <span className="text-[11px] text-muted-foreground">
              {boundCount} of {sources.length} bound
            </span>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            title="Close"
            aria-label="Close workflow testing"
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </div>

      {/* Sources + Output as an accordion so a finished run can hand the space
          over to the Output. The whole body scrolls (overflow-y-auto), so tall
          tabs like Frames never spill outside their border. */}
      <Accordion
        type="multiple"
        value={openSections}
        onValueChange={setOpenSections}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4"
      >
        <AccordionItem value="sources">
          <AccordionTrigger className="py-3">Sources (Inputs)</AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="flex flex-col gap-2.5">
              {sources.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                  Add a source node (Video Stream, GPS, IMU, Telemetry) to the
                  graph to test this workflow.
                </p>
              ) : (
                sources.map((s) => (
                  <SourceInputRow
                    key={s.id}
                    label={s.label}
                    catalogType={s.catalogType}
                    binding={bindings[s.id]}
                    onBind={(b) => bind(s.id, b)}
                    onUnbind={() => unbind(s.id)}
                    onPreview={setPreview}
                  />
                ))
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="output">
          <AccordionTrigger className="py-3">Output</AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="min-h-64 rounded-md border border-border bg-muted/30 p-3">
              <SimulatorOutput
                definition={ranDefinition}
                bindings={bindings}
                result={result}
                running={running}
              />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="shrink-0 border-t border-border p-3">
        <Button
          type="button"
          className="w-full gap-1.5"
          onClick={runWorkflow}
          disabled={running}
        >
          <PlayIcon className="size-3.5" />
          {running ? "Running…" : "Run Workflow"}
        </Button>
      </div>

      <SourcePreviewDialog
        binding={preview}
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
      />
    </aside>
  )
}
