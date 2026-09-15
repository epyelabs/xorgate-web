import { useEffect, useState } from "react"
import { toast } from "sonner"
import { DownloadIcon, LayersIcon, PlayIcon, TriangleAlertIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DataTable, type DataTableColumn } from "@/components/data-table"
import { StatusBadge } from "@/components/models/status-badge"
import { xgMessage } from "@/lib/xorgate"
import { getVersion, triggerDownload } from "@/lib/models-api"
import { formatDateTime, VERSION_STATUS_COLOR, VERSION_STATUS_LABEL } from "@/lib/models-format"
import type { DatasetDetail, DatasetVersion } from "@/lib/models-schemas"
import { useDatasetVersions } from "@/queries/models"

// Every version of the dataset with its split stats, the health warnings the
// builder recorded, the three files once ready, and Train. The newest ready
// version is the one Train defaults to everywhere else on the page.
function splitLine(v: DatasetVersion): string {
  const s = v.stats
  if (!s) return "—"
  return `${s.images.train} / ${s.images.val} / ${s.images.test}`
}

export function VersionsTab({
  dataset,
  canTrain,
  canAnnotate,
  onNewVersion,
  onTrain,
}: {
  dataset: DatasetDetail
  canTrain: boolean
  canAnnotate: boolean
  onNewVersion: () => void
  onTrain: (version: DatasetVersion) => void
}) {
  const versionsQuery = useDatasetVersions(dataset.id)
  const [files, setFiles] = useState<Record<number, Record<string, string>>>({})

  useEffect(() => {
    if (versionsQuery.error) toast.error(xgMessage(versionsQuery.error))
  }, [versionsQuery.error])

  const versions = versionsQuery.data ?? []
  const latestReady = versions.filter((v) => v.status === "ready").sort((a, b) => b.version - a.version)[0] ?? null

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
          <span className="inline-flex items-center gap-1.5 text-sm font-medium">
            v{v.version}
            {latestReady && v.id === latestReady.id ? (
              <Badge variant="secondary" className="h-4 px-1.5">
                latest
              </Badge>
            ) : null}
          </span>
          {v.message ? <span className="max-w-xs truncate text-xs text-muted-foreground">{v.message}</span> : null}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (v) => (
        <span className="flex flex-col gap-0.5">
          <StatusBadge
            color={VERSION_STATUS_COLOR[v.status] ?? "bg-zinc-400"}
            label={VERSION_STATUS_LABEL[v.status] ?? v.status}
            pulse={v.status === "building"}
          />
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
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex flex-wrap gap-1">
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
              </TooltipTrigger>
              <TooltipContent className="max-w-sm whitespace-pre-line">
                {[...v.health.errors, ...v.health.warnings].map((w) => w.message).join("\n")}
              </TooltipContent>
            </Tooltip>
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
            <Button
              variant={latestReady && v.id === latestReady.id ? "brand" : "outline"}
              size="sm"
              onClick={() => onTrain(v)}
              data-testid={`train-v${v.version}`}
            >
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
        rows={versions}
        getRowKey={(v) => v.id}
        loading={versionsQuery.isPending}
        empty={
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayersIcon />
              </EmptyMedia>
              <EmptyTitle>No versions yet</EmptyTitle>
              <EmptyDescription>
                A version freezes the labeled items and their boxes into a train / val / test split. Training
                always reads a version, never the live dataset, so a result can be reproduced later.
              </EmptyDescription>
            </EmptyHeader>
            {canAnnotate ? (
              <EmptyContent>
                <Button variant="brand" size="sm" onClick={onNewVersion} disabled={(dataset.itemsByStatus.labeled ?? 0) === 0}>
                  <LayersIcon />
                  New version
                </Button>
                {(dataset.itemsByStatus.labeled ?? 0) === 0 ? (
                  <span className="text-[11px] text-muted-foreground">Label at least one item first.</span>
                ) : null}
              </EmptyContent>
            ) : null}
          </Empty>
        }
      />
    </div>
  )
}
