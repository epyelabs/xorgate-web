import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { formatRelative } from "@/lib/relative-time"
import type { WorkflowTemplateDetail } from "@/lib/workflow-schemas"

// Author / updated / usage line. Lives on the editor toolbar strip so the header
// itself stays focused on the title and actions. "Used by N devices" opens the
// usage side sheet.
export function TemplateMeta({
  template,
  onOpenUsage,
}: {
  template: WorkflowTemplateDetail
  onOpenUsage: () => void
}) {
  return (
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
      <span>Last Updated {formatRelative(template.updatedAt)} ago</span>
      <span>·</span>
      <Button
        type="button"
        variant="link"
        onClick={onOpenUsage}
        className="h-auto p-0 text-xs font-normal text-muted-foreground hover:text-foreground"
      >
        Used by {template.usedBy}{" "}
        {template.usedBy === 1 ? "device" : "devices"}
      </Button>
    </div>
  )
}
