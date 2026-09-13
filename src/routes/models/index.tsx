import { useEffect, useState } from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { toast } from "sonner"
import { ChevronDownIcon, FilterIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  DataTable,
  DataTableToolbar,
  StatusDot,
  type DataTableColumn,
} from "@/components/data-table"
import { StickyHeader } from "@/components/sticky-header"
import { xgMessage } from "@/lib/xorgate"
import { formatDateTime, formatMetric } from "@/lib/models-format"
import { MODEL_SCOPES, type ModelEntry, type ModelScope } from "@/lib/models-schemas"
import { useRegistryModels } from "@/queries/models"

export const Route = createFileRoute("/models/")({
  beforeLoad: requireAuth,
  component: RegistryListPage,
})

const SCOPE_COLOR: Record<ModelScope, string> = {
  organization: "bg-emerald-500",
  platform: "bg-sky-500",
}

// Platform and organization models in one table (design §5). Platform models
// are the manifests the engine ships; organization models are what training
// published, resolved first by every run in this organization (Q4).
function RegistryListPage() {
  const [query, setQuery] = useState("")
  const [scopeFilter, setScopeFilter] = useState<ModelScope | "any">("any")
  const [familyFilter, setFamilyFilter] = useState<string | "any">("any")
  const [includeArchived, setIncludeArchived] = useState(false)

  const modelsQuery = useRegistryModels({
    scope: scopeFilter === "any" ? undefined : scopeFilter,
    includeArchived,
  })
  const data = modelsQuery.data ?? null
  const error = data || !modelsQuery.error ? null : xgMessage(modelsQuery.error)
  useEffect(() => {
    if (modelsQuery.error && !modelsQuery.data) toast.error(xgMessage(modelsQuery.error))
  }, [modelsQuery.error, modelsQuery.data])

  const models = data?.models ?? []
  const families = [...new Set(models.map((m) => m.family))].sort()
  const q = query.trim().toLowerCase()
  const visible = models.filter(
    (m) =>
      (familyFilter === "any" || m.family === familyFilter) &&
      (q === "" ||
        m.name.toLowerCase().includes(q) ||
        m.label.toLowerCase().includes(q) ||
        m.classNames.some((c) => c.toLowerCase().includes(q))),
  )
  const isFiltered = q !== "" || scopeFilter !== "any" || familyFilter !== "any"

  const columns: DataTableColumn<ModelEntry>[] = [
    {
      id: "name",
      header: "Model",
      cell: (m) => (
        <Link to="/models/$id" params={{ id: m.id }} className="block leading-tight">
          <span className="block text-sm font-medium text-foreground hover:underline">
            {m.name}
            <span className="ml-1 font-mono text-xs text-muted-foreground">v{m.version}</span>
          </span>
          {m.label && m.label !== m.name ? (
            <span className="block max-w-md truncate text-xs text-muted-foreground">{m.label}</span>
          ) : null}
        </Link>
      ),
      csvValue: (m) => `${m.name}@${m.version}`,
    },
    {
      id: "scope",
      header: "Scope",
      cell: (m) => <StatusDot color={SCOPE_COLOR[m.scope]} label={m.scope} />,
      csvValue: (m) => m.scope,
    },
    { id: "family", header: "Family", cell: (m) => m.family, csvValue: (m) => m.family },
    {
      id: "classes",
      header: "Classes",
      cell: (m) => (
        <span className="text-xs" title={m.classNames.join(", ")}>
          {m.classNames.length}
          <span className="ml-1 text-muted-foreground">
            {m.classNames.slice(0, 3).join(", ")}
            {m.classNames.length > 3 ? ", …" : ""}
          </span>
        </span>
      ),
      csvValue: (m) => m.classNames.join(" "),
    },
    {
      id: "map50",
      header: "mAP50",
      numeric: true,
      cell: (m) => formatMetric(m.provenance?.metrics?.mAP50 ?? null),
      csvValue: (m) => m.provenance?.metrics?.mAP50 ?? "",
    },
    {
      id: "status",
      header: "Status",
      cell: (m) =>
        m.status === "archived" ? <Badge variant="outline">archived</Badge> : <span className="text-xs">ready</span>,
      csvValue: (m) => m.status,
    },
    {
      id: "trainedAt",
      header: "Trained",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (m) => (m.scope === "platform" ? "platform" : formatDateTime(m.provenance?.trainedAt ?? m.createdAt)),
      csvValue: (m) => m.provenance?.trainedAt ?? m.createdAt ?? "",
    },
  ]

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-0 min-w-0 flex-col gap-6 p-4 pt-0 group-has-data-[collapsible=icon]/sidebar-wrapper:h-[calc(100svh-3rem)]">
      <StickyHeader className="border-b border-border pb-4">
        <header className="flex flex-wrap items-start gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Registry</h1>
            <p className="text-sm text-muted-foreground">
              The models a workflow's detection node can name: the platform's, and the
              ones this organization trained. Yours resolve first.
            </p>
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
          getRowKey={(m) => m.id}
          loading={modelsQuery.isPending}
          isFiltered={isFiltered}
          toolbar={
            <DataTableToolbar
              search={{ value: query, onChange: setQuery, placeholder: "Filter by name, label or class…" }}
              searchAlign="right"
              filters={
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        <FilterIcon />
                        scope: {scopeFilter}
                        <ChevronDownIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {(["any", ...MODEL_SCOPES] as const).map((opt) => (
                        <DropdownMenuItem key={opt} onSelect={() => setScopeFilter(opt)}>
                          {opt}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuCheckboxItem
                        checked={includeArchived}
                        onSelect={(e) => {
                          e.preventDefault()
                          setIncludeArchived((v) => !v)
                        }}
                      >
                        Show archived
                      </DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        <FilterIcon />
                        family: {familyFilter}
                        <ChevronDownIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {["any", ...families].map((opt) => (
                        <DropdownMenuItem key={opt} onSelect={() => setFamilyFilter(opt)}>
                          {opt}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              }
            />
          }
          exportCsv={{ filename: "models.csv" }}
          footer={
            data?.roots.length ? (
              <span className="font-mono text-[10px] text-muted-foreground">
                resolves in {data.roots.join(" then ")}
              </span>
            ) : undefined
          }
          empty={<p className="py-10 text-center text-sm text-muted-foreground">No models are served yet.</p>}
          filteredEmpty={
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <p className="text-sm text-muted-foreground">No models match the current filters.</p>
              <button
                type="button"
                onClick={() => {
                  setQuery("")
                  setScopeFilter("any")
                  setFamilyFilter("any")
                }}
                className="text-xs text-primary underline-offset-2 hover:underline"
              >
                Clear filters
              </button>
            </div>
          }
        />
      )}
    </div>
  )
}
