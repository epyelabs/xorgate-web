import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatRelative } from "@/lib/relative-time"
import type { WorkflowDeployment } from "@/lib/workflow-schemas"

// "Where is this consumed?" — the instances (template deployed + tuned onto
// devices in a workspace) that reference this template. This is the same data
// that will eventually populate the device detail "Workflows" tab.
export function UsagePanel({ instances }: { instances: WorkflowDeployment[] }) {
  if (instances.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">Not deployed anywhere yet</p>
        <p className="text-xs text-muted-foreground">
          When this template is enabled on devices in a workspace, those
          deployments show up here.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-3 text-[10px] tracking-[0.14em] uppercase">
              Deployment
            </TableHead>
            <TableHead className="text-[10px] tracking-[0.14em] uppercase">
              Workspace
            </TableHead>
            <TableHead className="text-[10px] tracking-[0.14em] uppercase">
              Target
            </TableHead>
            <TableHead className="text-[10px] tracking-[0.14em] uppercase">
              Version
            </TableHead>
            <TableHead className="text-[10px] tracking-[0.14em] uppercase">
              State
            </TableHead>
            <TableHead className="text-[10px] tracking-[0.14em] uppercase">
              Last run
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {instances.map((instance) => (
            <TableRow key={instance.id}>
              <TableCell className="pl-3 text-sm font-medium">
                {instance.name}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {instance.workspaceName}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {instance.target}
              </TableCell>
              <TableCell className="text-xs tabular-nums">
                {instance.pinnedVersion === null ? (
                  <span className="text-muted-foreground">follows published</span>
                ) : (
                  <span>pinned v{instance.pinnedVersion}</span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={instance.enabled ? "default" : "outline"}>
                  {instance.enabled ? "enabled" : "paused"}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground tabular-nums">
                {instance.lastRunAt
                  ? `${formatRelative(instance.lastRunAt)} ago`
                  : "never"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
