import { useEffect, useState } from "react"
import { toast } from "sonner"
import { DownloadIcon, PlayIcon, TriangleAlertIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DataTable, StatusDot, type DataTableColumn } from "@/components/data-table"
import { xgMessage } from "@/lib/xorgate"
import { getVersion, triggerDownload } from "@/lib/models-api"
import { formatDateTime, VERSION_STATUS_COLOR } from "@/lib/models-format"
import type { DatasetDetail, DatasetVersion } from "@/lib/models-schemas"
import { useDatasetVersions } from "@/queries/models"
import { TrainDialog } from "@/routes/training-jobs/-components/train-dialog"

// Every version of the dataset with its split stats, the health warnings the
// builder recorded, the three files once ready, and Train.
function splitLine(v: DatasetVersion): string {
  const s = v.stats
  if (!s) return "—"
  return `${s.images.train} / ${s.images.val} / ${s.images.test}`
}

export function VersionsTab({
  dataset,
  canTrain,
  onNewVersion,
}: {
  dataset: DatasetDetail
  canTrain: boolean
  onNewVersion: () => void
}) {
  const versionsQuery = useDatasetVersions(dataset.id)
  const [trainVersion, setTrainVersion] = useState<DatasetVersion | null>(null)
  const [files, setFiles] = useState<Record<number, Record<string, string>>>({})

  useEffect(() => {
    if (versionsQuery.error) toast.error(xgMessage(versionsQuery.error))
  }, [versionsQuery.error])

  const loadFiles = async (v: DatasetVersion) => {
    if (files[v.version]) return
    try {
      const detail = await getVersion(dataset.id, v.version)
      if (detail.files) setFiles((prev) => ({ ...prev, [v.version]: detail.files as Record<string, string> }))
    } catch (err) {
      toast.error(xgMessage(err))
    }
  }

  const columns: DataTableColumn<DatasetVersion>[] = [
    {
      id: "version",
      header: "Version",
      cell: (v) => (
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-medium">v{v.version}</span>
          {v.message ? <span className="max-w-xs truncate text-xs text-muted-foreground">{v.message}</span> : null}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (v) => (
        <span className="flex flex-col gap-0.5">
          <StatusDot color={VERSION_STATUS_COLOR[v.status] ?? "bg-zinc-400"} label={v.status} pulse={v.status === "building"} />
          {v.status === "failed" && v.error ? (
            <span className="max-w-xs truncate text-[11px] text-destructive" title={v.error}>
              {v.error}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "images",
      header: "Images train / val / test",
      cellClassName: "tabular-nums",
      cell: (v) => splitLine(v),
    },
    {
      id: "boxes",
      header: "Boxes",
      numeric: true,
      cell: (v) => (v.stats ? v.stats.annotations.train + v.stats.annotations.val + v.stats.annotations.test : "—"),
    },
    {
      id: "classes",
      header: "Classes",
      cell: (v) => (
        <span className="flex flex-wrap gap-1">
          {v.classNames.map((c) => (
            <span key={c} className="rounded border border-border px-1.5 py-0.5 text-[11px]">
              {c}
              {v.stats?.perClass[c] ? (
                <span className="ml-1 text-muted-foreground tabular-nums">
                  {v.stats.perClass[c].train}/{v.stats.perClass[c].val}
                </span>
              ) : null}
            </span>
          ))}
        </span>
      ),
    },
    {
      id: "health",
      header: "Health",
      cell: (v) =>
        v.health ? (
          v.health.warnings.length === 0 && v.health.errors.length === 0 ? (
            <span className="text-xs text-muted-foreground">ok</span>
          ) : (
            <span className="flex flex-wrap gap-1" title={[...v.health.errors, ...v.health.warnings].map((w) => w.message).join("\n")}>
              {v.health.errors.map((e, i) => (
                <Badge key={`e${i}`} variant="destructive">
                  {e.code}
                </Badge>
              ))}
              {v.health.warnings.map((w, i) => (
                <Badge key={`w${i}`} variant="outline" className="gap-1">
                  <TriangleAlertIcon className="size-3 text-amber-500" />
                  {w.code}
                  {w.className ? `: ${w.className}` : ""}
                </Badge>
              ))}
            </span>
          )
        ) : (
          "—"
        ),
    },
    {
      id: "created",
      header: "Created",
      cellClassName: "text-muted-foreground tabular-nums",
      cell: (v) => formatDateTime(v.readyAt ?? v.createdAt),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (v) => (
        <span className="flex items-center justify-end gap-1">
          {v.status === "ready" ? (
            <DropdownMenu onOpenChange={(open) => open && void loadFiles(v)}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <DownloadIcon />
                  Files
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  The dataset v1 files a training job reads
                </DropdownMenuLabel>
                {files[v.version] ? (
                  Object.entries(files[v.version]).map(([name, url]) => (
                    <DropdownMenuItem key={name} onSelect={() => triggerDownload(url, name)}>
                      {name}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {canTrain && v.status === "ready" ? (
            <Button variant="brand" size="sm" onClick={() => setTrainVersion(v)} data-testid={`train-v${v.version}`}>
              <PlayIcon />
              Train
            </Button>
          ) : null}
        </span>
      ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <DataTable
        fillHeight
        className="min-h-0 flex-1"
        columns={columns}
        rows={versionsQuery.data ?? []}
        getRowKey={(v) => v.id}
        loading={versionsQuery.isPending}
        empty={
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm font-medium">No versions yet</p>
            <p className="text-xs text-muted-foreground">
              A version freezes the labeled items into a train / val split a job can train on.
            </p>
            <button type="button" onClick={onNewVersion} className="text-xs text-primary underline-offset-2 hover:underline">
              New version
            </button>
          </div>
        }
      />
      <TrainDialog
        datasetName={dataset.name}
        version={trainVersion}
        open={trainVersion !== null}
        onOpenChange={(open) => {
          if (!open) setTrainVersion(null)
        }}
      />
    </div>
  )
}
