import { EyeIcon, RotateCcwIcon, UploadIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, type DataTableColumn } from "@/components/data-table"
import { formatRelative } from "@/lib/relative-time"
import type {
  VersionStatus,
  WorkflowTemplateVersion,
} from "@/lib/workflow-schemas"

function statusVariant(
  status: VersionStatus,
): "default" | "secondary" | "outline" {
  if (status === "published") return "default"
  if (status === "draft") return "secondary"
  return "outline"
}

interface VersionsPanelProps {
  versions: WorkflowTemplateVersion[]
  loadedVersionId: string | null
  busy: boolean
  onView: (version: WorkflowTemplateVersion) => void
  onRestore: (version: WorkflowTemplateVersion) => void
  onPublish: (version: WorkflowTemplateVersion) => void
}

export function VersionsPanel({
  versions,
  loadedVersionId,
  busy,
  onView,
  onRestore,
  onPublish,
}: VersionsPanelProps) {
  const ordered = [...versions].sort((a, b) => b.version - a.version)

  const columns: DataTableColumn<WorkflowTemplateVersion>[] = [
    {
      id: "version",
      header: "Version",
      headClassName: "w-20 pl-3",
      cellClassName: "pl-3 font-medium tabular-nums",
      cell: (version) => `v${version.version}`,
    },
    {
      id: "status",
      header: "Status",
      cell: (version) => (
        <Badge variant={statusVariant(version.status)}>{version.status}</Badge>
      ),
    },
    {
      id: "message",
      header: "Change note",
      cellClassName: "max-w-72 text-muted-foreground",
      cell: (version) => version.message ?? "—",
    },
    {
      id: "author",
      header: "Author",
      cellClassName: "text-muted-foreground",
      cell: (version) => version.createdBy.name,
    },
    {
      id: "created",
      header: "Created",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (version) => `${formatRelative(version.createdAt)} ago`,
    },
    {
      id: "actions",
      header: "Actions",
      align: "right",
      cell: (version) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onView(version)}
          >
            <EyeIcon />
            {version.id === loadedVersionId ? "Viewing" : "View"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onRestore(version)}
          >
            <RotateCcwIcon />
            Restore
          </Button>
          {version.status !== "published" ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onPublish(version)}
            >
              <UploadIcon />
              Publish
            </Button>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <div className="rounded-lg border border-border">
      <DataTable
        card={false}
        columns={columns}
        rows={ordered}
        getRowKey={(version) => version.id}
        rowState={(version) =>
          version.id === loadedVersionId ? "selected" : undefined
        }
      />
    </div>
  )
}
