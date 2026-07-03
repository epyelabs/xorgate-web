import { useRef, useState } from "react"
import {
  FileTextIcon,
  HardDriveIcon,
  PlayIcon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { NODE_CATALOG_BY_TYPE } from "@/lib/workflow-nodes"
import { cn } from "@/lib/utils"
import { SourceMediaDialog } from "./source-media-dialog"
import { SourceDeviceDialog } from "./source-device-dialog"
import {
  bindingLabel,
  bindingMeta,
  isVideoBinding,
  isVideoSource,
  type SensorMode,
  type SourceBinding,
  type VideoMode,
} from "./simulator-types"

// One row of the "Sources (Inputs)" section: an unbound source shows a mode
// dropdown + an action button; a bound source shows a chip (name + remove, and a
// play affordance for video). The selector shape is driven by the source's group
// — video vs sensor (GPS / IMU / telemetry).
export function SourceInputRow({
  label,
  catalogType,
  binding,
  onBind,
  onUnbind,
  onPreview,
}: {
  label: string
  catalogType: string
  binding: SourceBinding | undefined
  onBind: (binding: SourceBinding) => void
  onUnbind: () => void
  onPreview: (
    binding: Extract<SourceBinding, { kind: "video-file" | "video-recording" }>,
  ) => void
}) {
  const isVideo = isVideoSource(catalogType)
  const Icon = NODE_CATALOG_BY_TYPE[catalogType]?.icon ?? HardDriveIcon

  const [videoMode, setVideoMode] = useState<VideoMode>("file")
  const [sensorMode, setSensorMode] = useState<SensorMode>("csv")
  const [mediaOpen, setMediaOpen] = useState(false)
  const [deviceOpen, setDeviceOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset the input so re-picking the same file still fires onChange.
    e.target.value = ""
    if (!file) return
    if (isVideo) {
      onBind({
        kind: "video-file",
        file,
        url: URL.createObjectURL(file),
        name: file.name,
      })
    } else {
      onBind({ kind: "csv-file", file, name: file.name })
    }
  }

  const runAction = () => {
    if (isVideo) {
      if (videoMode === "file") fileRef.current?.click()
      else setMediaOpen(true)
    } else {
      if (sensorMode === "csv") fileRef.current?.click()
      else setDeviceOpen(true)
    }
  }

  const actionLabel = isVideo
    ? videoMode === "file"
      ? "Upload video"
      : "Select media from device"
    : sensorMode === "csv"
      ? "Upload .csv file"
      : "Select Device"

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 px-0.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-medium text-foreground">
          {label}
        </span>
      </div>

      {binding ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
          {isVideoBinding(binding) ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onPreview(binding)}
              title="Preview"
              aria-label="Preview"
            >
              <PlayIcon className="size-3.5" />
            </Button>
          ) : (
            <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
              {binding.kind === "csv-file" ? (
                <FileTextIcon className="size-3.5" />
              ) : (
                <HardDriveIcon className="size-3.5" />
              )}
            </span>
          )}
          <span className="min-w-0 flex-1" title={bindingLabel(binding)}>
            <span className="block truncate text-xs text-foreground">
              {bindingLabel(binding)}
            </span>
            {bindingMeta(binding) ? (
              <span className="block truncate text-[11px] text-muted-foreground">
                {bindingMeta(binding)}
              </span>
            ) : null}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onUnbind}
            title="Remove"
            aria-label="Remove source"
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {isVideo ? (
            <Select
              value={videoMode}
              onValueChange={(v) => setVideoMode(v as VideoMode)}
            >
              <SelectTrigger className="h-9 w-32 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="file">File</SelectItem>
                <SelectItem value="recordings">Recordings</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Select
              value={sensorMode}
              onValueChange={(v) => setSensorMode(v as SensorMode)}
            >
              <SelectTrigger className="h-9 w-32 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="device">From Device</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button
            type="button"
            variant="secondary"
            className={cn("h-9 flex-1 justify-center gap-1.5")}
            onClick={runAction}
          >
            <UploadIcon className="size-3.5" />
            <span className="truncate">{actionLabel}</span>
          </Button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={isVideo ? "video/*" : ".csv,text/csv"}
        className="hidden"
        onChange={onFilePicked}
      />

      <SourceMediaDialog
        open={mediaOpen}
        onOpenChange={setMediaOpen}
        onConfirm={onBind}
      />
      <SourceDeviceDialog
        open={deviceOpen}
        onOpenChange={setDeviceOpen}
        onConfirm={onBind}
      />
    </div>
  )
}
