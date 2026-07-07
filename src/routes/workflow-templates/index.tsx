import { useEffect, useMemo, useState } from "react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  ChevronDownIcon,
  FilterIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
import {
  ColHead,
  EmptyState,
  FilteredEmptyState,
  TemplateStatusCell,
  TemplatesTableSkeleton,
} from "./-components/templates-table-parts"

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

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name or description…"
              className="pl-7"
            />
          </div>
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
          {templates ? (
            <span className="ml-auto text-xs text-muted-foreground">
              Showing {filtered.length} of {templates.length}
            </span>
          ) : null}
        </div>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : isLoading ? (
          <TemplatesTableSkeleton />
        ) : templates && templates.length === 0 ? (
          <EmptyState onCreate={() => setCreateOpen(true)} />
        ) : filtered.length === 0 ? (
          <FilteredEmptyState onClear={clearFilters} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <ColHead>Name</ColHead>
                <ColHead>Status</ColHead>
                <ColHead>Version</ColHead>
                <ColHead>Used by</ColHead>
                <ColHead>Created by</ColHead>
                <ColHead>Updated</ColHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((template) => (
                <TableRow key={template.id}>
                  <TableCell>
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
                  </TableCell>
                  <TableCell>
                    <TemplateStatusCell status={template.status} />
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    v{template.publishedVersion ?? template.currentVersion}
                    {template.publishedVersion !== null &&
                    template.currentVersion > template.publishedVersion ? (
                      <span className="ml-1 text-muted-foreground">
                        (draft v{template.currentVersion})
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {template.usedBy > 0
                      ? `${template.usedBy} ${template.usedBy === 1 ? "deployment" : "deployments"}`
                      : "—"}
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {formatRelative(template.updatedAt)} ago
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

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
