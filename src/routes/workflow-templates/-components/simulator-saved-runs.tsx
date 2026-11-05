import { useState } from "react"
import { Loader2Icon, Trash2Icon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { RunStatus } from "@/lib/workflow-run-schemas"
import type { SavedSimulation } from "@/lib/workflow-sim-schemas"
import { formatSeconds } from "./simulator-types"

// The simulator's "Saved runs" section and its two dialogs (name a save,
// confirm a delete). A save is a per-user bookmark on a landed simulation run
// row; Load re-reads that row into the Output (owned by the panel).

// Shared with the panel's Output status badge.
export const SUCCEEDED_BADGE_CLASS =
  "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
export const CANCELLED_BADGE_CLASS =
  "bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"

const STATUS_LABEL: Record<RunStatus, string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
}

function SavedStatusBadge({ status }: { status: RunStatus }) {
  if (status === "failed") {
    return <Badge variant="destructive">{STATUS_LABEL[status]}</Badge>
  }
  return (
    <Badge
      variant="secondary"
      className={
        status === "succeeded"
          ? SUCCEEDED_BADGE_CLASS
          : status === "cancelled"
            ? CANCELLED_BADGE_CLASS
            : undefined
      }
    >
      {STATUS_LABEL[status]}
    </Badge>
  )
}

const startedFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

function formatStarted(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : startedFormat.format(d)
}

export function SavedRunsList({
  saved,
  isPending,
  error,
  shownRunId,
  loadingId,
  loadDisabled,
  onLoad,
  onDelete,
}: {
  saved: SavedSimulation[] | undefined
  isPending: boolean
  error: string | null
  // The run the Output currently shows (its row is marked).
  shownRunId: string | null
  loadingId: string | null
  // True while a run is in flight: loading would replace its live view.
  loadDisabled: boolean
  onLoad: (s: SavedSimulation) => void
  onDelete: (s: SavedSimulation) => Promise<void>
}) {
  const [confirm, setConfirm] = useState<SavedSimulation | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!confirm) return
    setDeleting(true)
    try {
      await onDelete(confirm)
      setConfirm(null)
    } finally {
      setDeleting(false)
    }
  }

  let body: React.ReactNode
  if (isPending) {
    body = (
      <div className="flex items-center gap-2 px-1 py-3 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" />
        Loading saved runs…
      </div>
    )
  } else if (error && !saved) {
    body = (
      <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
        Could not load saved runs: {error}
      </p>
    )
  } else if (!saved || saved.length === 0) {
    body = (
      <p
        className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground"
        data-testid="sim-saved-empty"
      >
        No saved runs yet. Finish a run, then use Save run to keep it here.
      </p>
    )
  } else {
    body = (
      <ul className="flex flex-col gap-1.5" data-testid="sim-saved-list">
        {saved.map((s) => {
          const shown = s.runId === shownRunId
          return (
            <li
              key={s.id}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${shown ? "border-primary/40 bg-primary/5" : "border-border"}`}
              data-testid="sim-saved-row"
              data-run-id={s.runId}
            >
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-xs font-medium text-foreground"
                  title={s.name}
                >
                  {s.name}
                </p>
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
                  <SavedStatusBadge status={s.run.status} />
                  <span>{formatStarted(s.run.startedAt)}</span>
                  {s.run.durationMs !== null ? (
                    <>
                      <span>·</span>
                      <span>{formatSeconds(s.run.durationMs / 1000)}</span>
                    </>
                  ) : null}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onLoad(s)}
                disabled={loadDisabled || loadingId !== null}
                data-testid="sim-saved-load"
              >
                {loadingId === s.id ? (
                  <Loader2Icon className="animate-spin" />
                ) : null}
                {shown ? "Shown" : "Load"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setConfirm(s)}
                title="Delete saved run"
                aria-label={`Delete saved run ${s.name}`}
                data-testid="sim-saved-delete"
              >
                <Trash2Icon />
              </Button>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <>
      {body}
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setConfirm(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete saved run</DialogTitle>
            <DialogDescription>
              Removes{" "}
              <span className="font-medium text-foreground">
                {confirm?.name}
              </span>{" "}
              from your saved runs. The run itself stays listed under Workflow
              Instances.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={deleting}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              data-testid="sim-saved-delete-confirm"
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Name prompt for Save run. Mounted only while open, so the name field starts
// from the default each time.
export function SaveRunDialog({
  defaultName,
  onOpenChange,
  onSave,
}: {
  defaultName: string
  onOpenChange: (open: boolean) => void
  onSave: (name: string) => Promise<boolean>
}) {
  const [name, setName] = useState(defaultName)
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      if (await onSave(name.trim() || defaultName)) onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Save run</DialogTitle>
            <DialogDescription>
              Keep this run in your saved runs for this template, to reopen
              its results in the simulator later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sim-save-name">Name</Label>
            <Input
              id="sim-save-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              autoFocus
              data-testid="sim-save-name"
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={saving}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={saving}
              data-testid="sim-save-confirm"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
