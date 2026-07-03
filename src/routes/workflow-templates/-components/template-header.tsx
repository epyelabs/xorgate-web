import { PlayIcon, SaveIcon, UploadIcon, WorkflowIcon } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatRelative } from "@/lib/relative-time"
import type {
  WorkflowTemplateDetail,
  WorkflowTemplateVersion,
} from "@/lib/workflow-schemas"

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })

function formatDate(iso: string): string {
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? iso : dateFormat.format(parsed)
}

interface TemplateHeaderProps {
  template: WorkflowTemplateDetail
  loadedVersion: WorkflowTemplateVersion | null
  dirty: boolean
  busy: boolean
  onSelectVersion: (versionId: string) => void
  onSaveDraft: () => void
  onPublish: () => void
  onSimulate: () => void
  onGoUsage: () => void
}

// Read-only summary header. Name/description editing lives on the Settings tab;
// here they are display-only so the bar stays focused on version + actions.
export function TemplateHeader({
  template,
  loadedVersion,
  dirty,
  busy,
  onSelectVersion,
  onSaveDraft,
  onPublish,
  onSimulate,
  onGoUsage,
}: TemplateHeaderProps) {
  const orderedVersions = [...template.versions].sort(
    (a, b) => b.version - a.version
  )

  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <Avatar size="lg">
          <AvatarFallback>
            <WorkflowIcon className="size-4" />
          </AvatarFallback>
        </Avatar>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-xl font-semibold tracking-tight">
              {template.name}
            </h1>
            <Badge
              variant={
                template.status === "published" ? "default" : "secondary"
              }
            >
              {template.status}
            </Badge>
            {dirty ? (
              <Badge variant="outline" className="text-amber-600">
                unsaved changes
              </Badge>
            ) : null}

            <div className="ml-auto flex items-center gap-2">
              <Select
                value={loadedVersion?.id ?? ""}
                onValueChange={onSelectVersion}
                disabled={busy}
              >
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Select version" />
                </SelectTrigger>
                <SelectContent>
                  {orderedVersions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      v{v.version} ({v.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={onSimulate}
                disabled={busy}
              >
                <PlayIcon />
                Simulate
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onSaveDraft}
                disabled={busy || !dirty}
              >
                <SaveIcon />
                Save draft
              </Button>
              <Button size="sm" onClick={onPublish} disabled={busy}>
                <UploadIcon />
                Publish
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Avatar className="size-4">
                <AvatarFallback className="text-[8px]">
                  {template.createdBy.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {template.createdBy.name}
            </span>
            <span>·</span>
            <span>created {formatDate(template.createdAt)}</span>
            <span>·</span>
            <span>updated {formatRelative(template.updatedAt)} ago</span>
            <span>·</span>
            <button
              type="button"
              onClick={onGoUsage}
              className="underline-offset-2 hover:text-foreground hover:underline"
            >
              Used by {template.usedBy}
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
