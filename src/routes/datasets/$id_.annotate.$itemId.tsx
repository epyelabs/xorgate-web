import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { toast } from "sonner"
import {
  ArrowLeftIcon,
  CheckCheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleHelpIcon,
  ExpandIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { isXorgateError } from "@xorgate/sdk"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusDot } from "@/components/data-table"
import { cn } from "@/lib/utils"
import { xgMessage } from "@/lib/xorgate"
import { useHasPermission } from "@/lib/permissions"
import { apiErrorStatus, putAnnotations } from "@/lib/models-api"
import { classIndexForKey, KEYBOARD_MAP, type Box } from "@/lib/annotation-geometry"
import { ITEM_STATUS_COLOR, ITEM_STATUS_LABEL } from "@/lib/models-format"
import {
  ITEM_SOURCE_KINDS,
  ITEM_STATUSES,
  type Annotation,
  type AnnotationInput,
  type ItemSourceKind,
  type ItemStatus,
} from "@/lib/models-schemas"
import {
  useDataset,
  useDatasetItemSequence,
  useInvalidateModels,
  useItemAnnotations,
} from "@/queries/models"
import { useBreadcrumbStore } from "@/store/breadcrumb"
import { AddClassPopover } from "./-components/annotator/add-class-popover"
import { AnnotatorStage, type StageBox } from "./-components/annotator/annotator-stage"

interface AnnotateSearch {
  status?: ItemStatus
  class?: string
  source?: ItemSourceKind
}

export const Route = createFileRoute("/datasets/$id_/annotate/$itemId")({
  beforeLoad: requireAuth,
  validateSearch: (search: Record<string, unknown>): AnnotateSearch => ({
    status: ITEM_STATUSES.includes(search.status as ItemStatus) ? (search.status as ItemStatus) : undefined,
    class: typeof search.class === "string" ? search.class : undefined,
    source: ITEM_SOURCE_KINDS.includes(search.source as ItemSourceKind) ? (search.source as ItemSourceKind) : undefined,
  }),
  component: AnnotatorPage,
})

// Autosave: every change schedules a replace-all PUT after this pause; a
// navigation flushes it first.
const AUTOSAVE_MS = 800

let keyCounter = 0
const newKey = () => `b${++keyCounter}`

function fromAnnotation(a: Annotation): StageBox {
  return {
    key: a.id,
    classId: a.classId,
    box: { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 },
    source: a.source,
    confidence: a.confidence,
  }
}

function toInput(b: StageBox, sourceRef: string | null): AnnotationInput {
  return {
    classId: b.classId,
    x1: b.box.x1,
    y1: b.box.y1,
    x2: b.box.x2,
    y2: b.box.y2,
    source: b.source,
    ...(b.source === "model" ? { sourceRef, confidence: b.confidence } : {}),
  }
}

function AnnotatorPage() {
  const { id: datasetId, itemId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const canAnnotate = useHasPermission("models:annotate")
  const invalidate = useInvalidateModels()

  const datasetQuery = useDataset(datasetId)
  const dataset = datasetQuery.data ?? null
  const annQuery = useItemAnnotations(datasetId, itemId)
  const seqQuery = useDatasetItemSequence(datasetId, search)

  const notFound = isXorgateError(annQuery.error) && annQuery.error.status === 404
  const error = annQuery.data || !annQuery.error || notFound ? null : xgMessage(annQuery.error)

  // --- working copy ----------------------------------------------------------------
  const [boxes, setBoxes] = useState<StageBox[]>([])
  const [etag, setEtag] = useState<string | null>(null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [activeClassIdx, setActiveClassIdx] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [fitSignal, setFitSignal] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)
  const [addClassOpen, setAddClassOpen] = useState(false)
  const [sourceRef, setSourceRef] = useState<string | null>(null)
  const saveTimer = useRef<number | null>(null)
  // Mirrors of the working copy for the debounced save and the unmount
  // flush, which run outside a render; synced after every commit.
  const boxesRef = useRef(boxes)
  const etagRef = useRef(etag)
  const dirtyRef = useRef(dirty)
  useEffect(() => {
    boxesRef.current = boxes
    etagRef.current = etag
    dirtyRef.current = dirty
  }, [boxes, etag, dirty])

  // Seed the working copy from the server once per item (the query never
  // refetches on focus, so this runs exactly on load and on Reload).
  const serverData = annQuery.data
  const serverKey = serverData ? `${itemId}:${serverData.etag}` : null
  useEffect(() => {
    if (!serverData || loadedFor === serverKey) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setBoxes(serverData.annotations.map(fromAnnotation))
    setEtag(serverData.etag)
    setLoadedFor(serverKey)
    setSelectedKey(null)
    setDirty(false)
    setConflict(false)
    setFitSignal((n) => n + 1)
    setSourceRef(serverData.annotations.find((a) => a.source === "model")?.sourceRef ?? null)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [serverData, serverKey, loadedFor])

  useEffect(() => {
    if (dataset) useBreadcrumbStore.getState().setDatasetName(dataset.name)
    return () => {
      useBreadcrumbStore.getState().setDatasetName(null)
    }
  }, [dataset])

  const item = serverData?.item ?? null
  const classes = useMemo(() => dataset?.classes ?? [], [dataset])
  const activeClass = classes[activeClassIdx] ?? classes[0] ?? null
  const pending = boxes.filter((b) => b.source === "model")

  // --- save ------------------------------------------------------------------------
  const save = useCallback(
    async (explicitStatus?: "labeled" | "ai_labeled"): Promise<boolean> => {
      const currentEtag = etagRef.current
      if (!currentEtag || !item) return false
      const snapshot = boxesRef.current
      const status = explicitStatus ?? (snapshot.some((b) => b.source === "model") ? "ai_labeled" : "labeled")
      setSaving(true)
      try {
        const res = await putAnnotations(datasetId, itemId, currentEtag, {
          annotations: snapshot.map((b) => toInput(b, sourceRef)),
          status,
        })
        setEtag(res.etag)
        // Server ids replace client keys so a later edit round-trips cleanly.
        if (boxesRef.current === snapshot) {
          setBoxes(res.annotations.map(fromAnnotation))
          setSelectedKey(null)
          setDirty(false)
        }
        return true
      } catch (err) {
        if (apiErrorStatus(err) === 412) {
          setConflict(true)
        } else toast.error(xgMessage(err))
        return false
      } finally {
        setSaving(false)
      }
    },
    [datasetId, itemId, item, sourceRef],
  )

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      if (dirtyRef.current && !conflict) void save()
    }, AUTOSAVE_MS)
  }, [save, conflict])

  const flush = useCallback(async () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (dirtyRef.current && !conflict) await save()
  }, [save, conflict])

  const mutate = useCallback(
    (fn: (prev: StageBox[]) => StageBox[]) => {
      if (!canAnnotate) return
      const next = fn(boxesRef.current)
      boxesRef.current = next
      dirtyRef.current = true
      setBoxes(next)
      setDirty(true)
      scheduleSave()
    },
    [canAnnotate, scheduleSave],
  )

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault()
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [])

  // --- navigation -----------------------------------------------------------------
  const ids = seqQuery.data?.ids ?? []
  const index = ids.indexOf(itemId)
  const prevId = index > 0 ? ids[index - 1] : null
  const nextId = index >= 0 && index < ids.length - 1 ? ids[index + 1] : null
  const nextUrl = nextId ? (seqQuery.data?.urls.get(nextId) ?? null) : null

  const goTo = useCallback(
    async (target: string | null) => {
      if (!target) return
      await flush()
      navigate({ to: "/datasets/$id/annotate/$itemId", params: { id: datasetId, itemId: target }, search, replace: true })
    },
    [flush, navigate, datasetId, search],
  )

  const acceptAll = useCallback(() => {
    mutate((prev) => prev.map((b) => (b.source === "model" ? { ...b, source: "human", confidence: null } : b)))
  }, [mutate])
  const rejectAll = useCallback(() => {
    mutate((prev) => prev.filter((b) => b.source !== "model"))
  }, [mutate])

  const markLabeledAndAdvance = useCallback(async () => {
    if (!canAnnotate) return
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    setBoxes((prev) => prev.map((b) => (b.source === "model" ? { ...b, source: "human", confidence: null } : b)))
    boxesRef.current = boxesRef.current.map((b) => (b.source === "model" ? { ...b, source: "human", confidence: null } : b))
    const ok = await save("labeled")
    if (ok) {
      invalidate.dataset(datasetId)
      if (nextId) navigate({ to: "/datasets/$id/annotate/$itemId", params: { id: datasetId, itemId: nextId }, search, replace: true })
      else toast.success("Labeled. This was the last item in the set.")
    }
  }, [canAnnotate, save, invalidate, datasetId, nextId, navigate, search])

  // --- keyboard -------------------------------------------------------------------
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping()) return
      // A focused button already acts on Enter and Space through its own
      // click; the shortcuts below must not double it.
      if (document.activeElement?.tagName === "BUTTON" && (e.key === "Enter" || e.key === " ")) return
      if (e.key === " ") {
        e.preventDefault()
        setSpaceHeld(true)
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const cls = classIndexForKey(e.key, classes.length)
      if (cls !== null) {
        setActiveClassIdx(cls)
        if (selectedKey) {
          const target = classes[cls]
          mutate((prev) => prev.map((b) => (b.key === selectedKey ? { ...b, classId: target.id } : b)))
        }
        return
      }
      switch (e.key) {
        case "Delete":
        case "Backspace":
          if (selectedKey) {
            e.preventDefault()
            mutate((prev) => prev.filter((b) => b.key !== selectedKey))
            setSelectedKey(null)
          }
          break
        case "Escape":
          setSelectedKey(null)
          setHelpOpen(false)
          break
        case "a":
        case "A":
          acceptAll()
          break
        case "r":
        case "R":
          rejectAll()
          break
        case "Enter":
          e.preventDefault()
          void markLabeledAndAdvance()
          break
        case "[":
        case "ArrowLeft":
          e.preventDefault()
          void goTo(prevId)
          break
        case "]":
        case "ArrowRight":
          e.preventDefault()
          void goTo(nextId)
          break
        case "f":
        case "F":
          setFitSignal((n) => n + 1)
          break
        case "n":
        case "N":
          // The popover focuses its input on open; without this the same
          // keystroke would land in the field as a typed "n".
          e.preventDefault()
          if (canAnnotate) setAddClassOpen(true)
          break
        case "?":
          setHelpOpen((o) => !o)
          break
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false)
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [canAnnotate, classes, selectedKey, mutate, acceptAll, rejectAll, markLabeledAndAdvance, goTo, prevId, nextId])

  // Flush an unsaved edit when the page unmounts (a click on a breadcrumb).
  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      if (dirtyRef.current && !conflict) void save()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId])

  const reload = () => {
    setLoadedFor(null)
    setConflict(false)
    setDirty(false)
    void annQuery.refetch()
  }

  // --- render ---------------------------------------------------------------------
  if (notFound) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <p className="text-sm text-muted-foreground">Item not found.</p>
        <Link to="/datasets/$id" params={{ id: datasetId }} className="text-xs text-primary underline-offset-2 hover:underline">
          Back to the dataset
        </Link>
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }
  if (!dataset || !item) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4 pt-0">
        <Skeleton className="h-8 w-full max-w-2xl" />
        <Skeleton className="h-[70vh] w-full" />
      </div>
    )
  }

  const selected = boxes.find((b) => b.key === selectedKey) ?? null
  const counts = new Map<string, number>()
  for (const b of boxes) counts.set(b.classId, (counts.get(b.classId) ?? 0) + 1)
  const saveState = conflict ? "conflict" : saving ? "saving" : dirty ? "unsaved" : "saved"

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-0 min-w-0 flex-col gap-2 p-4 pt-0 group-has-data-[collapsible=icon]/sidebar-wrapper:h-[calc(100svh-3rem)]" data-testid="annotator">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link to="/datasets/$id" params={{ id: datasetId }} onClick={() => void flush()}>
            <ArrowLeftIcon />
            {dataset.name}
          </Link>
        </Button>
        <span className="font-mono text-[11px] text-muted-foreground" data-testid="annotator-position">
          {index >= 0 ? `${index + 1} of ${ids.length}` : seqQuery.isPending ? "…" : "not in the filtered set"}
          {search.status || search.class || search.source ? " (filtered)" : ""}
        </span>
        <StatusDot color={ITEM_STATUS_COLOR[item.status]} label={ITEM_STATUS_LABEL[item.status]} />
        <span className="text-[11px] text-muted-foreground">
          {item.width}x{item.height} · {item.source.kind}
        </span>
        <span
          className={cn(
            "text-[11px]",
            saveState === "conflict" ? "text-destructive" : saveState === "saved" ? "text-muted-foreground" : "text-amber-600",
          )}
          data-testid="annotator-save-state"
          data-state={saveState}
        >
          {saveState === "saving" ? (
            <span className="inline-flex items-center gap-1">
              <Loader2Icon className="size-3 animate-spin" /> saving
            </span>
          ) : saveState === "unsaved" ? (
            "unsaved changes"
          ) : saveState === "conflict" ? (
            "changed elsewhere"
          ) : (
            "saved"
          )}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="icon-sm" disabled={!prevId} onClick={() => void goTo(prevId)} aria-label="Previous item" data-testid="annotator-prev">
            <ChevronLeftIcon className="size-3.5" />
          </Button>
          <Button variant="outline" size="icon-sm" disabled={!nextId} onClick={() => void goTo(nextId)} aria-label="Next item" data-testid="annotator-next">
            <ChevronRightIcon className="size-3.5" />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => setFitSignal((n) => n + 1)} aria-label="Fit to stage" title="Fit (F)">
            <ExpandIcon className="size-3.5" />
          </Button>
          <Popover open={helpOpen} onOpenChange={setHelpOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="Keyboard help" title="Keyboard (?)" data-testid="annotator-help">
                <CircleHelpIcon className="size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              <p className="mb-2 text-xs font-medium">Keyboard</p>
              <table className="w-full text-[11px]">
                <tbody>
                  {KEYBOARD_MAP.map((k) => (
                    <tr key={k.keys}>
                      <td className="py-0.5 pr-2 align-top font-mono whitespace-nowrap text-muted-foreground">{k.keys}</td>
                      <td className="py-0.5">{k.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PopoverContent>
          </Popover>
          {canAnnotate ? (
            <Button variant="brand" size="sm" onClick={() => void markLabeledAndAdvance()} disabled={saving} data-testid="annotator-done">
              <CheckCheckIcon />
              {nextId ? "Labeled, next" : "Labeled"}
              <kbd className="ml-1 rounded bg-black/20 px-1 font-mono text-[9px]">↵</kbd>
            </Button>
          ) : null}
        </span>
      </div>

      {conflict ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs" data-testid="annotator-conflict">
          <span>This item was changed in another tab or by another person. Reload to see the current boxes; your unsaved edits here are dropped.</span>
          <Button variant="outline" size="sm" className="ml-auto" onClick={reload}>
            <RefreshCwIcon />
            Reload
          </Button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-3">
        <AnnotatorStage
          className="min-w-0 flex-1"
          imageUrl={item.url}
          width={item.width}
          height={item.height}
          boxes={boxes}
          classes={classes}
          selectedKey={selectedKey}
          activeClass={canAnnotate ? activeClass : null}
          spaceHeld={spaceHeld}
          fitSignal={fitSignal}
          onSelect={setSelectedKey}
          onChangeBox={(key, box: Box) => mutate((prev) => prev.map((b) => (b.key === key ? { ...b, box } : b)))}
          onDraw={(box) => {
            if (!activeClass) return
            const key = newKey()
            mutate((prev) => [...prev, { key, classId: activeClass.id, box, source: "human", confidence: null }])
            setSelectedKey(key)
          }}
          onAcceptBox={(key) => mutate((prev) => prev.map((b) => (b.key === key ? { ...b, source: "human", confidence: null } : b)))}
          onRejectBox={(key) => mutate((prev) => prev.filter((b) => b.key !== key))}
        />

        <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto" data-testid="annotator-panel">
          <section className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">Classes</p>
              {canAnnotate ? (
                <AddClassPopover
                  datasetId={datasetId}
                  classes={classes}
                  open={addClassOpen}
                  onOpenChange={setAddClassOpen}
                  onAdded={(i) => setActiveClassIdx(i)}
                >
                  <Button variant="ghost" size="icon-xs" aria-label="Add a class" title="Add a class (N)" data-testid="annotator-add-class">
                    <PlusIcon />
                  </Button>
                </AddClassPopover>
              ) : null}
            </div>
            {classes.length === 0 ? (
              <p className="px-2 text-[11px] text-muted-foreground">No classes yet. Add one to start drawing boxes.</p>
            ) : null}
            {classes.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setActiveClassIdx(i)
                  if (selectedKey) mutate((prev) => prev.map((b) => (b.key === selectedKey ? { ...b, classId: c.id } : b)))
                }}
                className={cn(
                  "flex items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-muted/50",
                  i === activeClassIdx ? "bg-muted font-medium" : "",
                )}
                aria-pressed={i === activeClassIdx}
                data-testid={`annotator-class-${i + 1}`}
              >
                <span className="size-3 rounded-sm" style={{ backgroundColor: c.color }} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">{counts.get(c.id) ?? 0}</span>
                {i < 9 ? <kbd className="rounded border border-border px-1 font-mono text-[9px] text-muted-foreground">{i + 1}</kbd> : null}
              </button>
            ))}
          </section>

          {pending.length > 0 ? (
            <section className="flex flex-col gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/5 p-2" data-testid="annotator-prelabels">
              <p className="text-xs">
                <span className="font-medium">{pending.length}</span> pre-label{pending.length === 1 ? "" : "s"} from{" "}
                <span className="font-mono text-[11px]">{sourceRef ?? "a model"}</span>
              </p>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={acceptAll} disabled={!canAnnotate} data-testid="annotator-accept-all">
                  Accept all <kbd className="ml-1 font-mono text-[9px]">A</kbd>
                </Button>
                <Button size="sm" variant="outline" onClick={rejectAll} disabled={!canAnnotate} data-testid="annotator-reject-all">
                  Reject all <kbd className="ml-1 font-mono text-[9px]">R</kbd>
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">Dashed boxes are pre-labels. Accepting makes them human labels on save.</p>
            </section>
          ) : null}

          <section className="flex flex-col gap-1">
            <p className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
              Boxes <Badge variant="secondary">{boxes.length}</Badge>
            </p>
            {boxes.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {canAnnotate ? "Drag on the image to draw a box in the selected class." : "No boxes."}
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {boxes.map((b) => {
                  const c = classes.find((x) => x.id === b.classId)
                  const sel = b.key === selectedKey
                  return (
                    <li key={b.key}>
                      <button
                        type="button"
                        onClick={() => setSelectedKey(sel ? null : b.key)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-[11px] hover:bg-muted/50",
                          sel ? "bg-muted" : "",
                        )}
                        data-testid="annotator-box-row"
                      >
                        <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: c?.color ?? "#94a3b8", opacity: b.source === "model" ? 0.5 : 1 }} />
                        <span className="min-w-0 flex-1 truncate">
                          {c?.name ?? "?"}
                          {b.source === "model" ? ` ${b.confidence?.toFixed(2) ?? ""}` : ""}
                        </span>
                        <span className="text-muted-foreground">
                          {Math.round(b.box.x2 - b.box.x1)}x{Math.round(b.box.y2 - b.box.y1)}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {selected && canAnnotate ? (
              <div className="mt-1 flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  onClick={() => {
                    mutate((prev) => prev.filter((b) => b.key !== selected.key))
                    setSelectedKey(null)
                  }}
                  data-testid="annotator-delete-box"
                >
                  <Trash2Icon />
                  Delete box
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedKey(null)}>
                  <XIcon />
                  Deselect
                </Button>
              </div>
            ) : null}
          </section>

          {!canAnnotate ? <p className="text-[11px] text-muted-foreground">Viewers can look but not label.</p> : null}
        </aside>
      </div>
      {nextUrl ? <img src={nextUrl} alt="" aria-hidden className="hidden" /> : null}
    </div>
  )
}
