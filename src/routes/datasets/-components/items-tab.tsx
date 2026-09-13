import { useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  CheckIcon,
  ChevronDownIcon,
  FilterIcon,
  Loader2Icon,
  SquareDashedIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTablePagination, StatusDot } from "@/components/data-table"
import { cn } from "@/lib/utils"
import { xgMessage } from "@/lib/xorgate"
import { deleteItem } from "@/lib/models-api"
import {
  IMPORT_STATUS_COLOR,
  ITEM_STATUS_COLOR,
  ITEM_STATUS_LABEL,
} from "@/lib/models-format"
import {
  ITEM_SOURCE_KINDS,
  ITEM_STATUSES,
  type DatasetDetail,
  type DatasetItem,
  type ItemSourceKind,
  type ItemStatus,
} from "@/lib/models-schemas"
import { formatRelative } from "@/lib/relative-time"
import {
  useDatasetImports,
  useDatasetItems,
  useInvalidateModels,
} from "@/queries/models"
import { UploadDropzone } from "./upload-dropzone"

// The items grid, modelled on the simulator's Frames dialog: zoom steps set
// the minimum column width, thumbnails are the browser-scaled originals
// (Q14, no server thumbnails), each shows its status and box count, and a
// click opens the annotator on that item with the same filter so prev / next
// walk the same set. Multi-select exists for one action: exclude.

const ZOOM_STEPS = [120, 160, 200, 280, 400]
const DEFAULT_ZOOM = 1
const PAGE_SIZES = [48, 96, 200]

export interface ItemFilter {
  status?: ItemStatus
  class?: string
  source?: ItemSourceKind
}

function ItemThumb({
  datasetId,
  item,
  filter,
  selecting,
  selected,
  onToggle,
  classColor,
}: {
  datasetId: string
  item: DatasetItem
  filter: ItemFilter
  selecting: boolean
  selected: boolean
  onToggle: () => void
  classColor: (id: string) => string
}) {
  const [loaded, setLoaded] = useState(false)
  void classColor
  const inner = (
    <>
      {!loaded ? <Skeleton className="absolute inset-0 rounded-none" /> : null}
      {item.url ? (
        <img
          src={item.url}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn("block size-full object-cover", loaded ? "" : "opacity-0")}
          onLoad={() => setLoaded(true)}
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.visibility = "hidden"
          }}
        />
      ) : null}
      <span className="absolute bottom-0.5 left-0.5 flex items-center gap-1 rounded bg-black/60 px-1 text-[9px] text-white">
        <span className={cn("size-1.5 rounded-full", ITEM_STATUS_COLOR[item.status])} />
        {ITEM_STATUS_LABEL[item.status]}
        {item.annotationCount > 0 ? ` · ${item.annotationCount}` : ""}
      </span>
      {selecting ? (
        <span
          className={cn(
            "absolute top-1 left-1 flex size-4 items-center justify-center rounded border bg-background/90",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50",
          )}
        >
          {selected ? <CheckIcon className="size-3" /> : null}
        </span>
      ) : null}
    </>
  )
  const className = cn(
    "relative block aspect-video w-full overflow-hidden rounded border bg-muted outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
    selected ? "border-primary ring-2 ring-primary/40" : "border-border",
  )
  if (selecting) {
    return (
      <button type="button" className={className} onClick={onToggle} aria-pressed={selected} data-testid="item-thumb" data-item-id={item.id}>
        {inner}
      </button>
    )
  }
  return (
    <Link
      to="/datasets/$id/annotate/$itemId"
      params={{ id: datasetId, itemId: item.id }}
      search={filter}
      className={className}
      title={`${item.width}x${item.height}, ${item.status}`}
      data-testid="item-thumb"
      data-item-id={item.id}
      data-status={item.status}
    >
      {inner}
    </Link>
  )
}

export function ItemsTab({
  dataset,
  openUploadSignal,
  canAnnotate,
}: {
  dataset: DatasetDetail
  openUploadSignal: number
  canAnnotate: boolean
}) {
  const [filter, setFilter] = useState<ItemFilter>({})
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(PAGE_SIZES[0])
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [excluding, setExcluding] = useState(false)
  const invalidate = useInvalidateModels()

  const itemsQuery = useDatasetItems(dataset.id, {
    limit: size,
    offset: (page - 1) * size,
    ...filter,
  })
  const importsQuery = useDatasetImports(dataset.id)
  const items = itemsQuery.data?.items ?? []
  const total = itemsQuery.data?.total ?? 0

  useEffect(() => {
    if (itemsQuery.error) toast.error(xgMessage(itemsQuery.error))
  }, [itemsQuery.error])

  // An import that just finished adds rows: refresh the grid and the counts.
  const activeImports = (importsQuery.data ?? []).filter((i) => i.status === "queued" || i.status === "running")
  const activeCount = activeImports.length
  useEffect(() => {
    if (activeCount === 0) invalidate.dataset(dataset.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCount])

  const classById = new Map(dataset.classes.map((c) => [c.id, c]))
  const classColor = (id: string) => classById.get(id)?.color ?? "#10b981"
  const width = ZOOM_STEPS[zoom]

  const changeFilter = (next: ItemFilter) => {
    setFilter(next)
    setPage(1)
    setSelected(new Set())
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const excludeSelected = async () => {
    if (selected.size === 0) return
    setExcluding(true)
    let deleted = 0
    let excluded = 0
    const failures: string[] = []
    for (const id of selected) {
      try {
        const res = await deleteItem(dataset.id, id)
        if (res.action === "deleted") deleted += 1
        else excluded += 1
      } catch (err) {
        failures.push(xgMessage(err))
      }
    }
    setExcluding(false)
    setSelected(new Set())
    setSelecting(false)
    invalidate.dataset(dataset.id)
    const parts: string[] = []
    if (deleted) parts.push(`${deleted} deleted`)
    if (excluded) parts.push(`${excluded} excluded (a version references them)`)
    if (failures.length) toast.error(`${failures.length} failed: ${failures[0]}`)
    else toast.success(parts.join(", ") || "Nothing changed")
  }

  const recentImports = (importsQuery.data ?? []).slice(0, 3)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {canAnnotate ? (
        <UploadDropzone
          datasetId={dataset.id}
          openSignal={openUploadSignal}
          onDone={() => invalidate.dataset(dataset.id)}
        />
      ) : null}

      {recentImports.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground" data-testid="imports-strip">
          <span className="font-medium">Imports:</span>
          {recentImports.map((imp) => {
            const p = (imp.progress ?? {}) as { framesSeen?: number; cursor?: number; segments?: number }
            return (
              <span key={imp.id} className="inline-flex items-center gap-1.5 rounded border border-border px-1.5 py-0.5" data-status={imp.status}>
                <StatusDot color={IMPORT_STATUS_COLOR[imp.status]} label={imp.status} />
                {imp.status === "running" && p.segments ? (
                  <span>
                    segment {p.cursor ?? 0}/{p.segments}
                  </span>
                ) : null}
                {imp.status === "succeeded" ? <span>{imp.itemsAdded} frames</span> : null}
                {imp.status === "failed" && imp.error ? (
                  <span className="max-w-xs truncate text-destructive" title={imp.error}>
                    {imp.error}
                  </span>
                ) : null}
                <span>{formatRelative(imp.createdAt)} ago</span>
              </span>
            )
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2" data-testid="items-toolbar">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" data-testid="filter-status">
              <FilterIcon />
              status: {filter.status ? ITEM_STATUS_LABEL[filter.status] : "any"}
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => changeFilter({ ...filter, status: undefined })}>any</DropdownMenuItem>
            {ITEM_STATUSES.map((s) => (
              <DropdownMenuItem key={s} onSelect={() => changeFilter({ ...filter, status: s })}>
                <span className={cn("size-2 rounded-full", ITEM_STATUS_COLOR[s])} />
                {ITEM_STATUS_LABEL[s]}
                {dataset.itemsByStatus[s] ? (
                  <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">{dataset.itemsByStatus[s]}</span>
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <FilterIcon />
              class: {filter.class ? (classById.get(filter.class)?.name ?? filter.class) : "any"}
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => changeFilter({ ...filter, class: undefined })}>any</DropdownMenuItem>
            {dataset.classes.map((c) => (
              <DropdownMenuItem key={c.id} onSelect={() => changeFilter({ ...filter, class: c.id })}>
                <span className="size-2 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name}
                <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">{dataset.classUsage[c.id] ?? 0}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <FilterIcon />
              source: {filter.source ?? "any"}
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => changeFilter({ ...filter, source: undefined })}>any</DropdownMenuItem>
            {ITEM_SOURCE_KINDS.map((s) => (
              <DropdownMenuItem key={s} onSelect={() => changeFilter({ ...filter, source: s })}>
                {s}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {filter.status || filter.class || filter.source ? (
          <Button variant="ghost" size="sm" onClick={() => changeFilter({})}>
            <XIcon />
            Clear
          </Button>
        ) : null}

        <span className="ml-auto flex items-center gap-1">
          {canAnnotate ? (
            selecting ? (
              <>
                <span className="mr-1 text-[11px] text-muted-foreground tabular-nums" data-testid="selected-count">
                  {selected.size} selected
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={selected.size === 0 || excluding}
                  onClick={() => void excludeSelected()}
                  data-testid="exclude-selected"
                >
                  {excluding ? <Loader2Icon className="animate-spin" /> : null}
                  Exclude {selected.size || ""}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelecting(false)
                    setSelected(new Set())
                  }}
                >
                  Done
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setSelecting(true)} data-testid="select-items">
                <SquareDashedIcon />
                Select
              </Button>
            )
          ) : null}
          <span className="ml-2 font-mono text-[10px] text-muted-foreground">min {width}px</span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={zoom === 0}
            onClick={() => setZoom((z) => Math.max(0, z - 1))}
            aria-label="Zoom out"
          >
            <ZoomOutIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            disabled={zoom === ZOOM_STEPS.length - 1}
            onClick={() => setZoom((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))}
            aria-label="Zoom in"
          >
            <ZoomInIcon className="size-3.5" />
          </Button>
        </span>
      </div>

      <div
        className="grid min-h-0 flex-1 auto-rows-max content-start items-start gap-1.5 overflow-y-auto rounded-md border border-border bg-muted/30 p-2"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${width}px, 1fr))` }}
        data-testid="items-grid"
        data-loading={itemsQuery.isPending ? "true" : "false"}
      >
        {itemsQuery.isPending
          ? Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="aspect-video w-full" />)
          : items.map((item) => (
              <ItemThumb
                key={item.id}
                datasetId={dataset.id}
                item={item}
                filter={filter}
                selecting={selecting}
                selected={selected.has(item.id)}
                onToggle={() => toggle(item.id)}
                classColor={classColor}
              />
            ))}
        {!itemsQuery.isPending && items.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center gap-1 py-16 text-center">
            <p className="text-sm font-medium">
              {dataset.itemCount === 0 ? "No frames yet" : "No items match the filter"}
            </p>
            <p className="text-xs text-muted-foreground">
              {dataset.itemCount === 0
                ? "Drop images above, or add frames from a device recording."
                : "Clear the filters to see everything."}
            </p>
          </div>
        ) : null}
      </div>

      <DataTablePagination
        page={page}
        pageSize={size}
        total={total}
        rowsOnPage={items.length}
        pageSizes={PAGE_SIZES}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setSize(s)
          setPage(1)
        }}
      />
    </div>
  )
}
