import { Badge } from "@/components/ui/badge"
import { DataTable, type DataTableColumn } from "@/components/data-table"
import { formatRelative } from "@/lib/relative-time"
import type { WorkflowDeployment } from "@/lib/workflow-schemas"

const columns: DataTableColumn<WorkflowDeployment>[] = [
  {
    id: "deployment",
    header: "Deployment",
    headClassName: "pl-3",
    cellClassName: "pl-3 text-sm font-medium",
    cell: (instance) => instance.name,
  },
  {
    id: "workspace",
    header: "Workspace",
    cellClassName: "text-muted-foreground",
    cell: (instance) => instance.workspaceName,
  },
  {
    id: "version",
    header: "Version",
    cellClassName: "tabular-nums",
    cell: (instance) =>
      instance.pinnedVersion === null ? (
        <span className="text-muted-foreground">follows published</span>
      ) : (
        <span>pinned v{instance.pinnedVersion}</span>
      ),
  },
  {
    id: "state",
    header: "State",
    cell: (instance) => (
      <Badge variant={instance.enabled ? "default" : "outline"}>
        {instance.enabled ? "enabled" : "paused"}
      </Badge>
    ),
  },
  {
    id: "lastRun",
    header: "Last run",
    cellClassName: "text-muted-foreground tabular-nums",
    cell: (instance) =>
      instance.lastRunAt ? `${formatRelative(instance.lastRunAt)} ago` : "never",
  },
]

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
      <DataTable
        card={false}
        columns={columns}
        rows={instances}
        getRowKey={(instance) => instance.id}
      />
    </div>
  )
}
