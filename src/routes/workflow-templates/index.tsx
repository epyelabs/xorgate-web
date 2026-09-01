import { useEffect, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { toast } from "sonner"
import { ChevronDownIcon, FilterIcon, PlusIcon } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  DataTable,
  DataTableToolbar,
  StatusDot,
  type DataTableColumn,
} from "@/components/data-table"
import { formatRelative } from "@/lib/relative-time"
import { listWorkflowTemplates } from "@/lib/workflow-templates-api"
import {
  listWorkflowTemplatesResponseSchema,
  type TemplateStatus,
  type WorkflowTemplateSummary,
} from "@/lib/workflow-schemas"
import {
  useInvalidateWorkflowTemplates,
  useWorkflowTemplates,
} from "@/queries/workflows"
import { StickyHeader } from "@/components/sticky-header"
import { CreateTemplateDialog } from "./-components/create-template-dialog"

export const Route = createFileRoute("/workflow-templates/")({
  beforeLoad: requireAuth,
  component: WorkflowTemplatesListPage,
})

const STATUS_OPTIONS: readonly (TemplateStatus | "any")[] = [
  "any",
  "published",
  "draft",
]

const TEMPLATE_STATUS_COLOR: Record<TemplateStatus, string> = {
  published: "bg-emerald-500",
  draft: "bg-amber-500",
}

type SortKey = "updatedAt" | "name"
const PAGE_SIZES = [25, 50, 100]
const DEFAULT_SIZE = 25
const EXPORT_CAP = 5000

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")
}

function WorkflowTemplatesListPage() {
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<TemplateStatus | "any">("any")
  const [createOpen, setCreateOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [sortBy, setSortBy] = useState<SortKey>("updatedAt")
  const [order, setOrder] = useState<"asc" | "desc">("desc")

  const status = statusFilter === "any" ? undefined : statusFilter

  // The tenant lives in the query key, so an org/workspace switch reads (or
  // starts) that tenant's own cache entry; filter changes hold the current
  // rows while the next page loads (keepPreviousData in the hook).
  const templatesQuery = useWorkflowTemplates({
    limit: size,
    offset: (page - 1) * size,
    order,
    sort: sortBy,
    status,
  })
  const data = templatesQuery.data ?? null
  const isLoading = templatesQuery.isPending
  const error =
    data || !templatesQuery.error
      ? null
      : (templatesQuery.error as Error).message
  const reload = useInvalidateWorkflowTemplates()

  useEffect(() => {
    if (templatesQuery.error && !templatesQuery.data) {
      toast.error((templatesQuery.error as Error).message)
    }
  }, [templatesQuery.error, templatesQuery.data])

  // Client-side name/description search over the current page.
  const q = query.trim().toLowerCase()
  const templates = data?.templates ?? []
  const visible = q
    ? templates.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.description ?? "").toLowerCase().includes(q)
      )
    : templates
  const isFiltered = q !== "" || statusFilter !== "any"

  const setStatus = (next: TemplateStatus | "any") => {
    setStatusFilter(next)
    setPage(1)
  }
  const clearFilters = () => {
    setQuery("")
    setStatusFilter("any")
    setPage(1)
  }
  const onToggleSort = (columnId: string) => {
    const key = columnId as SortKey
    if (key === sortBy) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"))
    } else {
      setSortBy(key)
      setOrder("desc")
    }
    setPage(1)
  }

  // Fetch every template matching the current server filters (paged), then apply
  // the client search — the table's standard Export CSV calls this.
  const getExportRows = async (): Promise<WorkflowTemplateSummary[]> => {
    const pageLimit = 200
    const all: WorkflowTemplateSummary[] = []
    let off = 0
    let total = Infinity
    while (off < total && all.length < EXPORT_CAP) {
      const raw = await listWorkflowTemplates({
        limit: pageLimit,
        offset: off,
        order,
        sort: sortBy,
        status,
      })
      const parsed = listWorkflowTemplatesResponseSchema.safeParse(raw)
      if (!parsed.success) break
      all.push(...parsed.data.templates)
      total = parsed.data.page?.total ?? parsed.data.templates.length
      if (parsed.data.templates.length === 0) break
      off += pageLimit
    }
    return q
      ? all.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            (t.description ?? "").toLowerCase().includes(q)
        )
      : all
  }

  const columns: DataTableColumn<WorkflowTemplateSummary>[] = [
    {
      id: "name",
      header: "Name",
      sortable: true,
      cell: (template) => (
        <Link
          to="/workflow-templates/$id"
          params={{ id: template.id }}
          className="block leading-tight"
        >
          <span className="block text-sm font-medium text-foreground hover:underline">
            {template.name}
          </span>
          {template.description ? (
            <span className="block max-w-md truncate text-xs text-muted-foreground">
              {template.description}
            </span>
          ) : null}
        </Link>
      ),
      csvValue: (template) => template.name,
    },
    {
      id: "status",
      header: "Status",
      cell: (template) => (
        <StatusDot
          color={TEMPLATE_STATUS_COLOR[template.status]}
          label={template.status}
        />
      ),
      csvValue: (template) => template.status,
    },
    {
      id: "version",
      header: "Version",
      cellClassName: "tabular-nums",
      cell: (template) => (
        <>
          v{template.publishedVersion ?? template.currentVersion}
          {template.publishedVersion !== null &&
          template.currentVersion > template.publishedVersion ? (
            <span className="ml-1 text-muted-foreground">
              (draft v{template.currentVersion})
            </span>
          ) : null}
        </>
      ),
      csvHeader: "Version",
      csvValue: (template) => template.publishedVersion ?? template.currentVersion,
    },
    {
      id: "usedBy",
      header: "Used by",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (template) =>
        template.usedBy > 0
          ? `${template.usedBy} ${template.usedBy === 1 ? "deployment" : "deployments"}`
          : "—",
      csvHeader: "Used by",
      csvValue: (template) => template.usedBy,
    },
    {
      id: "createdBy",
      header: "Created by",
      cell: (template) => (
        <span className="inline-flex items-center gap-1.5">
          <Avatar className="size-5">
            <AvatarFallback className="text-[9px]">
              {initials(template.createdBy.name).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-xs text-muted-foreground">
            {template.createdBy.name}
          </span>
        </span>
      ),
      csvHeader: "Created by",
      csvValue: (template) => template.createdBy.name,
    },
    {
      id: "updatedAt",
      header: "Updated",
      sortable: true,
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (template) => `${formatRelative(template.updatedAt)} ago`,
      csvHeader: "Updated",
      csvValue: (template) => template.updatedAt,
    },
  ]

  const statusFilterMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <FilterIcon />
          status: {statusFilter}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {STATUS_OPTIONS.map((opt) => (
          <DropdownMenuItem key={opt} onSelect={() => setStatus(opt)}>
            {opt}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-0 min-w-0 flex-col gap-6 p-4 pt-0 group-has-data-[collapsible=icon]/sidebar-wrapper:h-[calc(100svh-3rem)]">
      <StickyHeader className="border-b border-border pb-4">
        <header className="flex flex-wrap items-start gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Workflow Templates
            </h1>
            <p className="text-sm text-muted-foreground">
              Reusable intelligence pipelines. Compose device data into
              conclusions, then deploy onto fleets.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="brand"
              size="lg"
              onClick={() => setCreateOpen(true)}
            >
              <PlusIcon />
              New template
            </Button>
          </div>
        </header>
      </StickyHeader>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <DataTable
          fillHeight
          className="min-h-0 flex-1"
          columns={columns}
          rows={visible}
          getRowKey={(template) => template.id}
          loading={isLoading}
          isFiltered={isFiltered}
          sort={{ columnId: sortBy, dir: order }}
          onToggleSort={onToggleSort}
          toolbar={
            <DataTableToolbar
              search={{
                value: query,
                onChange: setQuery,
                placeholder: "Filter by name or description…",
              }}
              searchAlign="right"
              filters={statusFilterMenu}
            />
          }
          pagination={{
            page,
            pageSize: size,
            total: data?.total ?? 0,
            rowsOnPage: visible.length,
            pageSizes: PAGE_SIZES,
            onPageChange: setPage,
            onPageSizeChange: (s) => {
              setSize(s)
              setPage(1)
            },
          }}
          exportCsv={{
            filename: "workflow-templates.csv",
            getRows: getExportRows,
          }}
          empty={
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <p className="text-sm font-medium">No workflow templates yet</p>
              <p className="text-xs text-muted-foreground">
                Create a template to compose device data into conclusions.
              </p>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="text-xs text-primary underline-offset-2 hover:underline"
              >
                New template
              </button>
            </div>
          }
          filteredEmpty={
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                No templates match the current filters.
              </p>
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs text-primary underline-offset-2 hover:underline"
              >
                Clear filters
              </button>
            </div>
          }
        />
      )}

      <CreateTemplateDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) reload()
        }}
      />
    </div>
  )
}
