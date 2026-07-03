import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { WorkflowDeployment } from "@/lib/workflow-schemas"
import { UsagePanel } from "./usage-panel"

interface UsageSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  instances: WorkflowDeployment[]
}

// Side-sheet home for the deployments that consume this template, opened from
// the "Used by N" link in the header.
export function UsageSheet({ open, onOpenChange, instances }: UsageSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 data-[side=right]:sm:max-w-3xl"
      >
        <SheetHeader className="gap-1 border-b border-border pb-3">
          <SheetTitle className="pr-8">Usage</SheetTitle>
          <SheetDescription>
            Deployments that reference this template.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          <UsagePanel instances={instances} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
