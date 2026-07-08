import { useEffect, useMemo, useState } from "react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
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
import { useAuthStore } from "@/store/auth"
import { StickyHeader } from "@/components/sticky-header"
import { CreateTemplateDialog } from "./-components/create-template-dialog"

export const Route = createFileRoute("/workflow-templates/")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")
}

function WorkflowTemplatesListPage() {
  const [templates, setTemplates] = useState<WorkflowTemplateSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<TemplateStatus | "any">("any")
  const [createOpen, setCreateOpen] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const raw = await listWorkflowTemplates()
        const parsed = listWorkflowTemplatesResponseSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error("Unexpected /workflow-templates response shape")
        }
        if (cancelled) return
        setError(null)
        setTemplates(parsed.data.templates)
      } catch (err) {
        const message = (err as Error).message
        if (cancelled) return
        setError(message)
        setTemplates([])
        toast.error(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloadNonce])

  const isLoading = templates === null

  const filtered = useMemo(() => {
    if (!templates) return []
    const q = query.trim().toLowerCase()
    return templates.filter((t) => {
      if (statusFilter !== "any" && t.status !== statusFilter) return false
      if (!q) return true
      return (
        t.name.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q)
      )
    })
  }, [templates, query, statusFilter])

  const clearFilters = () => {
    setQuery("")
    setStatusFilter("any")
  }
  const isFiltered = query.trim() !== "" || statusFilter !== "any"

  const columns: DataTableColumn<WorkflowTemplateSummary>[] = [
    {
      id: "name",
      header: "Name",
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
    },
    {
      id: "usedBy",
      header: "Used by",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (template) =>
        template.usedBy > 0
          ? `${template.usedBy} ${template.usedBy === 1 ? "deployment" : "deployments"}`
          : "—",
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
    },
    {
      id: "updated",
      header: "Updated",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (template) => `${formatRelative(template.updatedAt)} ago`,
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
          <DropdownMenuItem key={opt} onSelect={() => setStatusFilter(opt)}>
            {opt}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
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
              variant="default"
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
          columns={columns}
          rows={filtered}
          getRowKey={(template) => template.id}
          loading={isLoading}
          isFiltered={isFiltered}
          toolbar={
            <DataTableToolbar
              search={{
                value: query,
                onChange: setQuery,
                placeholder: "Filter by name or description…",
              }}
              filters={statusFilterMenu}
              right={
                templates ? `Showing ${filtered.length} of ${templates.length}` : null
              }
            />
          }
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
          if (!open) setReloadNonce((n) => n + 1)
        }}
      />
    </div>
  )
}
