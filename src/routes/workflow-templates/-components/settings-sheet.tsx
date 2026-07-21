import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { WorkflowTemplateDetail } from "@/lib/workflow-schemas"
import { SettingsPanel } from "./settings-panel"

interface SettingsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  template: WorkflowTemplateDetail
  busy: boolean
  onSave: (updates: { name: string; description: string | null }) => void
  onDelete: () => Promise<void>
  onShowUsage: () => void
}

// Side-sheet home for template metadata (name + description) and deletion,
// opened from the header's overflow menu.
export function SettingsSheet({
  open,
  onOpenChange,
  template,
  busy,
  onSave,
  onDelete,
  onShowUsage,
}: SettingsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="gap-1 border-b border-border pb-3">
          <SheetTitle className="pr-8">Template settings</SheetTitle>
          <SheetDescription>
            Edit the name and description, or delete the template.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          <SettingsPanel
            template={template}
            busy={busy}
            onSave={onSave}
            onDelete={onDelete}
            onShowUsage={onShowUsage}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
