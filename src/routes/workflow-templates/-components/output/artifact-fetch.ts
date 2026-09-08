import { useEffect, useState } from "react"
import { toast } from "sonner"
import { getRunArtifactUrl } from "@/lib/workflow-instances-api"
import { artifactFileName, JSON_VIEW_MAX_BYTES } from "./run-artifacts"

// Browser-side access to a run's S3 artifacts through the presigned
// artifact-url endpoint. Every read presigns fresh (URLs expire in ~5 min).

export async function presign(runId: string, key: string): Promise<string> {
  return (await getRunArtifactUrl(runId, key)).url
}

// Object size without downloading it: Content-Length is a CORS-safelisted
// response header, so a plain GET exposes it; the body is cancelled right
// after the headers arrive. Null when the header is missing.
export async function probeSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url)
    const len = res.headers.get("content-length")
    await res.body?.cancel().catch(() => {})
    if (!res.ok) return null
    return len !== null && len !== "" ? Number(len) : null
  } catch {
    return null
  }
}

export type ArtifactText =
  | { kind: "text"; text: string; size: number }
  | { kind: "too-large"; size: number }
  | { kind: "error"; message: string }

// Reads a text artifact under the viewer cap; a larger object is reported as
// download-only without being pulled into memory.
export async function fetchArtifactText(
  url: string,
  cap = JSON_VIEW_MAX_BYTES,
): Promise<ArtifactText> {
  try {
    const res = await fetch(url)
    if (!res.ok) return { kind: "error", message: `HTTP ${res.status}` }
    const declared = Number(res.headers.get("content-length") ?? "")
    if (Number.isFinite(declared) && declared > cap) {
      await res.body?.cancel().catch(() => {})
      return { kind: "too-large", size: declared }
    }
    const text = await res.text()
    if (text.length > cap) return { kind: "too-large", size: text.length }
    return { kind: "text", text, size: Number.isFinite(declared) ? declared : text.length }
  } catch (err) {
    return { kind: "error", message: (err as Error).message }
  }
}

// Parses a JSON or JSONL artifact for the tree viewer. JSONL becomes an array
// of lines; a line that fails to parse is kept as a raw string so the file is
// still inspectable.
export function parseArtifactText(text: string, format: "json" | "jsonl"): unknown {
  if (format === "json") return JSON.parse(text)
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      try {
        return JSON.parse(line) as unknown
      } catch {
        return line
      }
    })
}

// Triggers a browser download: the presigned URL carries a signed
// Content-Disposition so the file lands under the folded key name.
export async function downloadArtifact(runId: string, key: string): Promise<void> {
  try {
    const { url } = await getRunArtifactUrl(runId, key, { download: true })
    const a = document.createElement("a")
    a.href = url
    a.download = artifactFileName(runId, key)
    a.rel = "noopener"
    document.body.appendChild(a)
    a.click()
    a.remove()
  } catch (err) {
    toast.error((err as Error).message)
  }
}

// Presigned URL for one key, refreshed when the key changes; null while
// loading or when the key is null.
export function useArtifactUrl(runId: string, key: string | null): {
  url: string | null
  error: string | null
} {
  const [state, setState] = useState<{ key: string | null; url: string | null; error: string | null }>({
    key: null,
    url: null,
    error: null,
  })
  useEffect(() => {
    if (!key) return
    let cancelled = false
    presign(runId, key).then(
      (url) => {
        if (!cancelled) setState({ key, url, error: null })
      },
      (err: Error) => {
        if (!cancelled) setState({ key, url: null, error: err.message })
      },
    )
    return () => {
      cancelled = true
    }
  }, [runId, key])
  if (!key || state.key !== key) return { url: null, error: null }
  return { url: state.url, error: state.error }
}
