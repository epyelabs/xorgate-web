import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { WorkflowTemplateVersion } from "@/lib/workflow-schemas"
import { VersionsPanel } from "./versions-panel"

interface VersionsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  versions: WorkflowTemplateVersion[]
  loadedVersionId: string | null
  busy: boolean
  onView: (version: WorkflowTemplateVersion) => void
  onRestore: (version: WorkflowTemplateVersion) => void
  onPublish: (version: WorkflowTemplateVersion) => void
}

// Side-sheet home for the version history, opened from the version selector in
// the header. Navigate, view, restore, or publish any version from here.
export function VersionsSheet({
  open,
  onOpenChange,
  versions,
  loadedVersionId,
  busy,
  onView,
  onRestore,
  onPublish,
}: VersionsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Widen past the sheet default (sm:max-w-sm) so the versions table fits;
          reuse the same data-side variant key so tailwind-merge lets this win. */}
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 data-[side=right]:sm:max-w-3xl"
      >
        <SheetHeader className="gap-1 border-b border-border pb-3">
          <SheetTitle className="pr-8">Versions</SheetTitle>
          <SheetDescription>
            View, restore, or publish any version of this template.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          <VersionsPanel
            versions={versions}
            loadedVersionId={loadedVersionId}
            busy={busy}
            onView={onView}
            onRestore={onRestore}
            onPublish={onPublish}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
