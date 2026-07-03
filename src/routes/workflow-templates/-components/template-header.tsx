import {
  HistoryIcon,
  SettingsIcon,
  UploadIcon,
  WorkflowIcon,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import type {
  WorkflowTemplateDetail,
  WorkflowTemplateVersion,
} from "@/lib/workflow-schemas"

interface TemplateHeaderProps {
  template: WorkflowTemplateDetail
  loadedVersion: WorkflowTemplateVersion | null
  dirty: boolean
  busy: boolean
  onOpenVersions: () => void
  onOpenSettings: () => void
  onSaveDraft: () => void
  onPublish: () => void
}

// Read-only summary header. Name/description editing lives in the settings sheet;
// the author/usage metadata lives on the editor toolbar. This bar stays focused
// on the title, status, and version + actions.
export function TemplateHeader({
  template,
  loadedVersion,
  dirty,
  busy,
  onOpenVersions,
  onOpenSettings,
  onSaveDraft,
  onPublish,
}: TemplateHeaderProps) {
  return (
    <header>
      <div className="flex items-center gap-3">
        <Avatar size="sm">
          <AvatarFallback>
            <WorkflowIcon className="size-4" />
          </AvatarFallback>
        </Avatar>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="min-w-0 text-xl font-semibold tracking-tight">
            {template.name}
          </h1>

          <div className="ml-auto flex items-center gap-2">
            {/* Opens the versions side sheet — a history affordance, not a
                dropdown. Sized to content so it stays compact. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenVersions}
              disabled={busy}
              className="gap-1.5 text-muted-foreground"
            >
              <HistoryIcon className="size-3.5" />
              {loadedVersion
                ? `v${loadedVersion.version} · ${loadedVersion.status}`
                : "Versions"}
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
            <Button
              variant="outline"
              size="icon-sm"
              onClick={onOpenSettings}
              disabled={busy}
              aria-label="Template settings"
            >
              <SettingsIcon />
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
