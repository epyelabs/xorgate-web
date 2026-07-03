import {
  ChevronDownIcon,
  EllipsisVerticalIcon,
  SettingsIcon,
  UploadIcon,
  WorkflowIcon,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  onOpenVersions: () => void
  onOpenUsage: () => void
  onOpenSettings: () => void
  onSaveDraft: () => void
  onPublish: () => void
}

// Read-only summary header. Name/description editing lives in the settings sheet
// (opened from the overflow menu); here they are display-only so the bar stays
// focused on version + actions. Versions and usage each open a side sheet.
export function TemplateHeader({
  template,
  loadedVersion,
  dirty,
  busy,
  onOpenVersions,
  onOpenUsage,
  onOpenSettings,
  onSaveDraft,
  onPublish,
}: TemplateHeaderProps) {
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

            <div className="ml-auto flex items-center gap-2">
              {/* The version selector now opens the versions side sheet, where
                  the user navigates, restores, and publishes versions. */}
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenVersions}
                disabled={busy}
                className="w-44 justify-between font-normal"
              >
                <span className="truncate">
                  {loadedVersion
                    ? `v${loadedVersion.version} (${loadedVersion.status})`
                    : "Versions"}
                </span>
                <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onSaveDraft}
                disabled={busy || !dirty}
              >
                Save draft
              </Button>
              <Button size="sm" onClick={onPublish} disabled={busy}>
                <UploadIcon />
                Publish
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={busy}
                    aria-label="More options"
                  >
                    <EllipsisVerticalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={onOpenSettings}>
                    <SettingsIcon />
                    Settings
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
              onClick={onOpenUsage}
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
