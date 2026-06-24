import { EyeIcon, RotateCcwIcon, UploadIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20 pl-3 text-[10px] tracking-[0.14em] uppercase">
              Version
            </TableHead>
            <TableHead className="text-[10px] tracking-[0.14em] uppercase">
              Status
            </TableHead>
            <TableHead className="text-[10px] tracking-[0.14em] uppercase">
              Change note
            </TableHead>
            <TableHead className="text-[10px] tracking-[0.14em] uppercase">
              Author
            </TableHead>
            <TableHead className="text-[10px] tracking-[0.14em] uppercase">
              Created
            </TableHead>
            <TableHead className="text-right text-[10px] tracking-[0.14em] uppercase">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ordered.map((version) => {
            const isLoaded = version.id === loadedVersionId
            return (
              <TableRow
                key={version.id}
                data-state={isLoaded ? "selected" : undefined}
              >
                <TableCell className="pl-3 font-medium tabular-nums">
                  v{version.version}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(version.status)}>
                    {version.status}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-72 text-xs text-muted-foreground">
                  {version.message ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {version.createdBy.name}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {formatRelative(version.createdAt)} ago
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => onView(version)}
                    >
                      <EyeIcon />
                      {isLoaded ? "Viewing" : "View"}
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
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
