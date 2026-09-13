import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { UploadIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { xgMessage } from "@/lib/xorgate"
import { createItemUploads, registerItems, uploadItemToS3 } from "@/lib/models-api"
import {
  IMAGE_CONTENT_TYPES,
  MAX_IMAGE_BYTES,
  MAX_UPLOADS_PER_CALL,
  type ImageContentType,
} from "@/lib/models-schemas"

// Native drag events plus a hidden file input, driving the presigned-POST
// flow (uploads -> S3 -> register) with bounded concurrency: files are
// batched by fifty (the uploads endpoint's cap), at most four S3 POSTs run
// together, and one register call closes each batch. Duplicates and
// rejections come back from the register call and are reported, never
// stored twice.
const MAX_IN_FLIGHT = 4

interface Progress {
  total: number
  done: number
  registered: number
  duplicates: number
  rejected: string[]
  failed: string[]
}

function contentTypeOf(file: File): ImageContentType | null {
  if ((IMAGE_CONTENT_TYPES as readonly string[]).includes(file.type)) return file.type as ImageContentType
  const name = file.name.toLowerCase()
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg"
  if (name.endsWith(".png")) return "image/png"
  return null
}

async function runBounded<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length)
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++
      try {
        results[i] = { status: "fulfilled", value: await tasks[i]() }
      } catch (reason) {
        results[i] = { status: "rejected", reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

export function UploadDropzone({
  datasetId,
  openSignal,
  onDone,
  className,
}: {
  datasetId: string
  /** Bumped by the page's Upload button to open the file picker. */
  openSignal: number
  onDone: () => void
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const lastSignal = useRef(openSignal)

  useEffect(() => {
    if (openSignal !== lastSignal.current) {
      lastSignal.current = openSignal
      inputRef.current?.click()
    }
  }, [openSignal])

  const upload = async (files: File[]) => {
    const accepted: Array<{ file: File; contentType: ImageContentType }> = []
    const rejected: string[] = []
    for (const file of files) {
      const contentType = contentTypeOf(file)
      if (!contentType) rejected.push(`${file.name}: not a JPEG or PNG`)
      else if (file.size > MAX_IMAGE_BYTES) rejected.push(`${file.name}: over 20 MiB`)
      else if (file.size === 0) rejected.push(`${file.name}: empty`)
      else accepted.push({ file, contentType })
    }
    if (accepted.length === 0) {
      toast.error(rejected[0] ?? "Nothing to upload")
      return
    }
    const state: Progress = { total: accepted.length, done: 0, registered: 0, duplicates: 0, rejected, failed: [] }
    setProgress({ ...state })
    try {
      for (let i = 0; i < accepted.length; i += MAX_UPLOADS_PER_CALL) {
        const batch = accepted.slice(i, i + MAX_UPLOADS_PER_CALL)
        const uploads = await createItemUploads(
          datasetId,
          batch.map((b) => ({ filename: b.file.name, contentType: b.contentType })),
        )
        const results = await runBounded(
          uploads.map((u, j) => async () => {
            await uploadItemToS3(u, batch[j].file)
            state.done += 1
            setProgress({ ...state })
            return u.key
          }),
          MAX_IN_FLIGHT,
        )
        const keys: string[] = []
        results.forEach((r, j) => {
          if (r.status === "fulfilled") keys.push(r.value)
          else {
            state.done += 1
            state.failed.push(`${batch[j].file.name}: ${(r.reason as Error).message}`)
          }
        })
        if (keys.length > 0) {
          const reg = await registerItems(datasetId, keys)
          state.registered += reg.items.length
          state.duplicates += reg.duplicates.length
          for (const rej of reg.rejected) {
            const name = batch[uploads.findIndex((u) => u.key === rej.key)]?.file.name ?? rej.key
            state.rejected.push(`${name}: ${rej.reason}`)
          }
        }
        setProgress({ ...state })
      }
      const parts = [`${state.registered} added`]
      if (state.duplicates) parts.push(`${state.duplicates} duplicate${state.duplicates === 1 ? "" : "s"} skipped`)
      if (state.rejected.length) parts.push(`${state.rejected.length} rejected`)
      if (state.failed.length) parts.push(`${state.failed.length} failed`)
      const summary = parts.join(", ")
      if (state.failed.length || state.rejected.length) {
        toast.warning(summary, { description: [...state.rejected, ...state.failed].slice(0, 3).join("\n") })
      } else toast.success(summary)
    } catch (err) {
      toast.error(xgMessage(err))
    } finally {
      setProgress(null)
      onDone()
    }
  }

  const onFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return
    void upload(Array.from(list))
  }

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground transition-colors",
        dragging ? "border-primary bg-primary/5 text-foreground" : "",
        className,
      )}
      onDragOver={(e) => {
        e.preventDefault()
        if (!dragging) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        onFiles(e.dataTransfer.files)
      }}
      data-testid="upload-dropzone"
      data-uploading={progress ? "true" : "false"}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files)
          e.target.value = ""
        }}
        data-testid="upload-input"
      />
      {progress ? (
        <span data-testid="upload-progress">
          Uploading {progress.done} / {progress.total}
          {progress.registered ? ` · ${progress.registered} registered` : ""}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <UploadIcon className="size-3.5" />
          Drop JPEG or PNG frames here, or
          <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={() => inputRef.current?.click()}>
            browse
          </Button>
          <span className="text-muted-foreground/70">(20 MiB each, duplicates skipped)</span>
        </span>
      )}
      {dragging ? (
        <span className="absolute top-1 right-1">
          <XIcon className="size-3 opacity-0" />
        </span>
      ) : null}
    </div>
  )
}
