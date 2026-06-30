import { useEffect, useState } from "react"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatRelative } from "@/lib/relative-time"
import {
  detachWorkflow,
  listDeviceAttachments,
  listDeviceRuns,
  runAttachmentNow,
  setAttachmentEnabled,
} from "@/lib/device-workflows-api"
import {
  listDeviceAttachmentsResponseSchema,
  type DeviceWorkflowAttachment,
} from "@/lib/device-workflow-schemas"
import {
  listWorkflowRunsResponseSchema,
  type WorkflowRunSummary,
} from "@/lib/workflow-run-schemas"
import { useAuthStore } from "@/store/auth"
import {
  AttachmentsEmptyState,
  AttachmentsSkeleton,
  AttachmentStatusCell,
  AttachmentTriggerBadge,
  AttachmentVersionCell,
} from "./-components/attachments-table-parts"
import { AttachWorkflowDialog } from "./-components/attach-workflow-dialog"
import {
  ColHead,
  EmptyState,
  formatDuration,
  RunsTableSkeleton,
  RunStatusCell,
} from "../workflow-instances/-components/runs-table-parts"

export const Route = createFileRoute("/devices/$id/workflows")({
  beforeLoad: () => {
    const { isAuthenticated, isLoading } = useAuthStore.getState()
    if (!isLoading && !isAuthenticated) {
      throw redirect({ to: "/login" })
    }
  },
  component: DeviceWorkflowsPage,
})

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function DeviceWorkflowsPage() {
  const { id } = Route.useParams()
  const [attachments, setAttachments] = useState<
    DeviceWorkflowAttachment[] | null
  >(null)
  const [runs, setRuns] = useState<WorkflowRunSummary[] | null>(null)
  const [attachOpen, setAttachOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [rawAttachments, rawRuns] = await Promise.all([
          listDeviceAttachments(id),
          listDeviceRuns(id),
        ])
        const parsedAttachments =
          listDeviceAttachmentsResponseSchema.safeParse(rawAttachments)
        const parsedRuns = listWorkflowRunsResponseSchema.safeParse(rawRuns)
        if (!parsedAttachments.success || !parsedRuns.success) {
          throw new Error("Unexpected device workflows response shape")
        }
        if (cancelled) return
        setAttachments(parsedAttachments.data.attachments)
        setRuns(parsedRuns.data.runs)
      } catch (err) {
        if (cancelled) return
        setAttachments([])
        setRuns([])
        toast.error((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const replaceAttachment = (next: DeviceWorkflowAttachment) =>
    setAttachments((prev) =>
      prev ? prev.map((a) => (a.id === next.id ? next : a)) : prev,
    )

  const handleRunNow = async (attachment: DeviceWorkflowAttachment) => {
    try {
      const { attachment: updated } = await runAttachmentNow(id, attachment.id)
      replaceAttachment(updated)
      toast.success(`Run queued for "${attachment.templateName}"`)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleToggle = async (attachment: DeviceWorkflowAttachment) => {
    try {
      const { attachment: updated } = await setAttachmentEnabled(
        id,
        attachment.id,
        !attachment.enabled,
      )
      replaceAttachment(updated)
      toast.success(updated.enabled ? "Workflow resumed" : "Workflow paused")
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleDetach = async (attachment: DeviceWorkflowAttachment) => {
    try {
      await detachWorkflow(id, attachment.id)
      setAttachments((prev) =>
        prev ? prev.filter((a) => a.id !== attachment.id) : prev,
      )
      toast.success(`Detached "${attachment.templateName}"`)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <Section
        title="Attached workflows"
        action={
          <Button size="sm" onClick={() => setAttachOpen(true)}>
            <PlusIcon />
            Attach workflow
          </Button>
        }
      >
        {attachments === null ? (
          <AttachmentsSkeleton />
        ) : attachments.length === 0 ? (
          <AttachmentsEmptyState onAttach={() => setAttachOpen(true)} />
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <ColHead>Workflow</ColHead>
                  <ColHead>Version</ColHead>
                  <ColHead>Trigger</ColHead>
                  <ColHead>State</ColHead>
                  <ColHead>Last run</ColHead>
                  <ColHead>Runs</ColHead>
                  <ColHead> </ColHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attachments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link
                        to="/workflow-templates/$id"
                        params={{ id: a.templateId }}
                        className="block leading-tight"
                      >
                        <span className="block text-sm font-medium text-foreground hover:underline">
                          {a.templateName}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {a.templateSlug}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <AttachmentVersionCell
                        pinnedVersion={a.pinnedVersion}
                        runningVersion={a.runningVersion}
                      />
                    </TableCell>
                    <TableCell className="leading-tight">
                      <AttachmentTriggerBadge trigger={a.trigger} />
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {a.triggerDetail}
                      </span>
                    </TableCell>
                    <TableCell>
                      <AttachmentStatusCell enabled={a.enabled} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {a.lastRunAt ? (
                        <span className="inline-flex items-center gap-1.5">
                          {a.lastRunStatus ? (
                            <RunStatusCell status={a.lastRunStatus} />
                          ) : null}
                          <span>{formatRelative(a.lastRunAt)} ago</span>
                        </span>
                      ) : (
                        "never"
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {a.runCount > 0 ? a.runCount : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm">
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => handleRunNow(a)}>
                            <PlayIcon />
                            Run now
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => handleToggle(a)}>
                            {a.enabled ? (
                              <>
                                <PauseIcon />
                                Pause
                              </>
                            ) : (
                              <>
                                <PlayIcon />
                                Resume
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => handleDetach(a)}
                          >
                            <Trash2Icon />
                            Detach
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section title="Recent runs">
        {runs === null ? (
          <RunsTableSkeleton />
        ) : runs.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <ColHead>Workflow</ColHead>
                  <ColHead>Trigger</ColHead>
                  <ColHead>Status</ColHead>
                  <ColHead>Started</ColHead>
                  <ColHead>Duration</ColHead>
                  <ColHead>Events</ColHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="leading-tight">
                      <Link
                        to="/workflow-instances/$id"
                        params={{ id: run.id }}
                        className="block text-sm font-medium text-foreground hover:underline"
                      >
                        {run.templateName}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        v{run.templateVersion}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {run.trigger}
                    </TableCell>
                    <TableCell>
                      <RunStatusCell status={run.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {formatRelative(run.startedAt)} ago
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {formatDuration(run.durationMs)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {run.eventCount > 0 ? run.eventCount : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <AttachWorkflowDialog
        deviceId={id}
        open={attachOpen}
        onOpenChange={setAttachOpen}
        onAttached={(attachment) =>
          setAttachments((prev) => (prev ? [attachment, ...prev] : [attachment]))
        }
      />
    </div>
  )
}
